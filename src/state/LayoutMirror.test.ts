/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientEvent, type MatrixEvent, type Room } from "matrix-js-sdk";

import {
  createLayoutMirror,
  createLayoutOps,
  LayoutEventType,
  type LayoutOp,
} from "./LayoutMirror.ts";
import { type RecordingState } from "./Recording.ts";
import { constant, state } from "./Behavior.ts";
import { mockEmitter, testScope } from "../utils/test.ts";

const bot = "@bot:e";

function recording(extra: Partial<RecordingState> = {}): RecordingState {
  return {
    by: "@alice:e",
    recorder: bot,
    media: "video",
    streams: "composite",
    eventId: "$req",
    started: false,
    requiresConsent: false,
    consents: {},
    awaitingConsent: [],
    directorDevice: "ALICEDEV",
    ...extra,
  };
}

function setup(
  userId = "@alice:e",
  deviceId = "ALICEDEV",
): {
  room: Room;
  sendToDevice: ReturnType<typeof vi.fn>;
} {
  const sendToDevice = vi.fn().mockResolvedValue({});
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    hasEncryptionStateEvent: () => false,
    client: {
      ...mockEmitter(),
      sendToDevice,
      getUserId: () => userId,
      getDeviceId: () => deviceId,
    },
  } as unknown as Room;
  return { room, sendToDevice };
}

const pin: LayoutOp = {
  type: "pin",
  user_id: "@bob:e",
  device_id: "BOBDEV",
  pinned: true,
};

describe("layout director", () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("sends each op to the recorder's devices while directing", async () => {
    const { room, sendToDevice } = setup();
    const recording$ = state<RecordingState | null>(null);
    const ops = createLayoutOps();
    const mirror = createLayoutMirror(testScope(), room, {
      recording$,
      recorderDevices$: constant(["BOT1", "BOT2"]),
      ops,
      snapshot: () => [],
      apply: () => {},
    });
    ops.emit(pin);
    expect(sendToDevice).not.toHaveBeenCalled();
    recording$.value = recording();
    expect(mirror.directing$.value).toBe(true);
    ops.emit(pin);
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(1));
    const content = {
      room_id: "!room",
      request: "$req",
      device_id: "ALICEDEV",
      seq: 1,
      op: pin,
    };
    expect(sendToDevice).toHaveBeenCalledWith(
      LayoutEventType,
      new Map([
        [
          bot,
          new Map([
            ["BOT1", content],
            ["BOT2", content],
          ]),
        ],
      ]),
    );
    // Stopping stops directing
    recording$.value = null;
    ops.emit(pin);
    expect(sendToDevice).toHaveBeenCalledTimes(1);
  });

  it("only directs from the named device", () => {
    const { room } = setup("@alice:e", "OTHERDEV");
    const mirror = createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording()),
      recorderDevices$: constant(["BOT1"]),
      ops: createLayoutOps(),
      snapshot: () => [],
      apply: () => {},
    });
    expect(mirror.directing$.value).toBe(false);
  });

  it("sends only volumes for an audio recording", async () => {
    const { room, sendToDevice } = setup();
    const ops = createLayoutOps();
    const mirror = createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording({ media: "audio" })),
      recorderDevices$: constant(["BOT1"]),
      ops,
      snapshot: () => [],
      apply: () => {},
    });
    expect(mirror.directing$.value).toBe(true);
    ops.emit(pin);
    ops.emit({ ...pin, type: "volume", volume: 50 } as LayoutOp);
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(1));
    expect(sendToDevice.mock.calls[0][1].get(bot).get("BOT1").op.type).toBe(
      "volume",
    );
  });

  it("settles a stream of volume changes into one message", async () => {
    vi.useFakeTimers();
    const { room, sendToDevice } = setup();
    const ops = createLayoutOps();
    createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording()),
      recorderDevices$: constant(["BOT1"]),
      ops,
      snapshot: () => [],
      apply: () => {},
    });
    const volume = (v: number): LayoutOp => ({
      type: "volume",
      user_id: "@bob:e",
      device_id: "BOBDEV",
      volume: v,
    });
    ops.emit(volume(90));
    ops.emit(volume(80));
    ops.emit(volume(70));
    await vi.advanceTimersByTimeAsync(300);
    expect(sendToDevice).toHaveBeenCalledTimes(1);
    expect(sendToDevice.mock.calls[0][1].get(bot).get("BOT1").op).toEqual(
      volume(70),
    );
  });

  it("catches the recorder up once it has started", async () => {
    const { room, sendToDevice } = setup();
    const recording$ = state<RecordingState | null>(recording());
    createLayoutMirror(testScope(), room, {
      recording$,
      recorderDevices$: constant(["BOT1"]),
      ops: createLayoutOps(),
      snapshot: () => [{ type: "layout", layout: "spotlight" }, pin],
      apply: () => {},
    });
    expect(sendToDevice).not.toHaveBeenCalled();
    recording$.value = recording({ started: true });
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(2));
    expect(
      sendToDevice.mock.calls.map((c) => c[1].get(bot).get("BOT1").seq),
    ).toEqual([1, 2]);
  });

  it("waits for the recorder's devices before catching it up", async () => {
    const { room, sendToDevice } = setup();
    const recorderDevices$ = state<string[]>([]);
    const ops = createLayoutOps();
    createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording({ started: true })),
      recorderDevices$,
      ops,
      snapshot: () => [pin],
      apply: () => {},
    });
    ops.emit(pin);
    await Promise.resolve();
    expect(sendToDevice).not.toHaveBeenCalled();
    recorderDevices$.value = ["BOT1"];
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(1));
    // Another device joining doesn't repeat it
    recorderDevices$.value = ["BOT1", "BOT2"];
    await Promise.resolve();
    expect(sendToDevice).toHaveBeenCalledTimes(1);
  });

  it("sends one message at a time, in order", async () => {
    const { room, sendToDevice } = setup();
    let sent = (): void => {};
    sendToDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        sent = resolve;
      }),
    );
    const ops = createLayoutOps();
    createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording()),
      recorderDevices$: constant(["BOT1"]),
      ops,
      snapshot: () => [],
      apply: () => {},
    });
    ops.emit(pin);
    ops.emit({ ...pin, pinned: false });
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(sendToDevice).toHaveBeenCalledTimes(1);
    sent();
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(2));
    expect(
      sendToDevice.mock.calls.map((c) => c[1].get(bot).get("BOT1").seq),
    ).toEqual([1, 2]);
  });

  it("carries on counting after a reload, within the same recording", async () => {
    const direct = async (request: string): Promise<number> => {
      const { room, sendToDevice } = setup();
      const ops = createLayoutOps();
      createLayoutMirror(testScope(), room, {
        recording$: state<RecordingState | null>(
          recording({ eventId: request }),
        ),
        recorderDevices$: constant(["BOT1"]),
        ops,
        snapshot: () => [],
        apply: () => {},
      });
      ops.emit(pin);
      await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(1));
      return sendToDevice.mock.calls[0][1].get(bot).get("BOT1").seq as number;
    };
    expect(await direct("$req")).toBe(1);
    expect(await direct("$req")).toBe(2);
    expect(await direct("$another")).toBe(1);
  });
});

describe("layout follower", () => {
  function toDevice(
    sender: string,
    content: Record<string, unknown>,
    type = LayoutEventType,
  ): MatrixEvent {
    return {
      getType: () => type,
      getSender: () => sender,
      getContent: () => content,
    } as unknown as MatrixEvent;
  }
  const content = (
    seq: number,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    room_id: "!room",
    request: "$req",
    device_id: "ALICEDEV",
    seq,
    op: pin,
    ...extra,
  });

  it("applies the director's ops, in order, and nobody else's", () => {
    const { room } = setup(bot, "BOT1");
    const recording$ = state<RecordingState | null>(null);
    const apply = vi.fn();
    const mirror = createLayoutMirror(testScope(), room, {
      recording$,
      recorderDevices$: constant([]),
      ops: createLayoutOps(),
      snapshot: () => [],
      apply,
    });
    const emit = (event: MatrixEvent): void => {
      room.client.emit(ClientEvent.ToDeviceEvent, event);
    };
    emit(toDevice("@alice:e", content(1)));
    expect(apply).not.toHaveBeenCalled();
    recording$.value = recording();
    expect(mirror.following$.value).toBe(true);
    emit(toDevice("@alice:e", content(1)));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(pin);
    // Late, repeated, or somebody else's
    emit(toDevice("@alice:e", content(1)));
    emit(toDevice("@bob:e", content(2)));
    emit(toDevice("@alice:e", content(3, { device_id: "OTHER" })));
    emit(toDevice("@alice:e", content(4, { request: "$old" })));
    emit(toDevice("@alice:e", content(5, { room_id: "!other" })));
    emit(toDevice("@alice:e", content(6), "io.element.call.other"));
    expect(apply).toHaveBeenCalledTimes(1);
    emit(toDevice("@alice:e", content(7)));
    expect(apply).toHaveBeenCalledTimes(2);
    // A recording without a director isn't followed
    recording$.value = recording({ directorDevice: undefined });
    expect(mirror.following$.value).toBe(false);
  });
});
