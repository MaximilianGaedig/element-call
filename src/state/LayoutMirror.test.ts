/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk";

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

  it("only directs from the named device, for video", () => {
    const { room } = setup("@alice:e", "OTHERDEV");
    const mirror = createLayoutMirror(testScope(), room, {
      recording$: state<RecordingState | null>(recording()),
      recorderDevices$: constant(["BOT1"]),
      ops: createLayoutOps(),
      snapshot: () => [],
    });
    expect(mirror.directing$.value).toBe(false);
    const { room: mine } = setup();
    const audio = createLayoutMirror(testScope(), mine, {
      recording$: state<RecordingState | null>(recording({ media: "audio" })),
      recorderDevices$: constant(["BOT1"]),
      ops: createLayoutOps(),
      snapshot: () => [],
    });
    expect(audio.directing$.value).toBe(false);
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
    });
    expect(sendToDevice).not.toHaveBeenCalled();
    recording$.value = recording({ started: true });
    await vi.waitFor(() => expect(sendToDevice).toHaveBeenCalledTimes(2));
    expect(
      sendToDevice.mock.calls.map((c) => c[1].get(bot).get("BOT1").seq),
    ).toEqual([1, 2]);
  });
});
