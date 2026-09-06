/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import {
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

import { createRecording, type RecordingEventContent } from "./Recording.ts";
import { constant } from "./Behavior.ts";
import { type FloorControl, RecordingEventType } from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";

const slot = "m.call#ROOM";
const bot = "@bot:e";

function event(
  sender: string,
  content: RecordingEventContent,
  id: string,
): MatrixEvent {
  return {
    getContent: () => content,
    getSender: () => sender,
    getId: () => id,
  } as unknown as MatrixEvent;
}

function setup(botMembership?: string): {
  room: Room;
  sendStateEvent: ReturnType<typeof vi.fn>;
  set: (event: MatrixEvent | null) => void;
} {
  let current: MatrixEvent | null = null;
  const sendStateEvent = vi.fn().mockResolvedValue({});
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    client: { sendStateEvent },
    currentState: {
      getStateEvents: (type: string, key: string) =>
        type === RecordingEventType && key === slot ? current : null,
    },
    getMember: (userId: string) =>
      userId === bot && botMembership !== undefined
        ? { membership: botMembership }
        : null,
  } as unknown as Room;
  return {
    room,
    sendStateEvent,
    set: (event) => {
      current = event;
      room.emit(RoomStateEvent.Update, null!);
    },
  };
}

const canRecord = { canRecord$: constant(true) } as unknown as FloorControl;

describe("createRecording", () => {
  it("reports the recording from room state", () => {
    const { room, set } = setup();
    const r = createRecording(testScope(), room, canRecord, slot, bot);
    expect(r.recording$.value).toBeNull();
    set(event("@alice:e", { recorder: bot, media: "audio" }, "$1"));
    expect(r.recording$.value).toEqual({
      by: "@alice:e",
      recorder: bot,
      media: "audio",
      streams: "composite",
      eventId: "$1",
    });
    set(event("@alice:e", {}, "$2"));
    expect(r.recording$.value).toBeNull();
  });

  it("invites the recorder before asking it to start, and stops by clearing", async () => {
    const { room, sendStateEvent, set } = setup();
    const r = createRecording(testScope(), room, canRecord, slot, bot);
    await r.toggle$.value!();
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      1,
      "!room",
      "m.room.member",
      { membership: "invite" },
      bot,
    );
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      2,
      "!room",
      RecordingEventType,
      { recorder: bot },
      slot,
    );
    set(event("@me:e", { recorder: bot }, "$1"));
    await r.toggle$.value!();
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      RecordingEventType,
      {},
      slot,
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
  });

  it("reports a failed request instead of throwing", async () => {
    const { room, sendStateEvent } = setup();
    sendStateEvent.mockRejectedValueOnce(new Error("429"));
    const r = createRecording(testScope(), room, canRecord, slot, bot);
    await r.toggle$.value!();
    expect(r.error$.value?.message).toBe("429");
    expect(r.recording$.value).toBeNull();
  });

  it("doesn't invite a recorder that's already in the room", async () => {
    const { room, sendStateEvent } = setup("join");
    await createRecording(testScope(), room, canRecord, slot, bot).toggle$
      .value!();
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it("offers nothing without a recorder or the power to record", () => {
    const { room } = setup();
    expect(
      createRecording(testScope(), room, canRecord, slot, undefined).toggle$
        .value,
    ).toBeNull();
    const cannot = { canRecord$: constant(false) } as unknown as FloorControl;
    expect(
      createRecording(testScope(), room, cannot, slot, bot).toggle$.value,
    ).toBeNull();
  });

  it("collects recordings the recorder posts", () => {
    const { room } = setup();
    const r = createRecording(testScope(), room, canRecord, slot, bot);
    const upload = (sender: string, content: object, id: string): void =>
      void room.emit(
        RoomEvent.Timeline,
        {
          getSender: () => sender,
          getType: () => "m.room.message",
          getContent: () => content,
          getId: () => id,
        } as unknown as MatrixEvent,
        room,
        false,
        false,
        null!,
      );
    upload("@alice:e", { msgtype: "m.video", url: "mxc://e/x" }, "$0");
    upload(bot, { msgtype: "m.notice", body: "Recording started." }, "$1");
    upload(
      bot,
      {
        msgtype: "m.video",
        body: "call.webm",
        url: "mxc://e/v",
        info: { thumbnail_url: "mxc://e/t" },
      },
      "$2",
    );
    // An encrypted upload, which only shows up once decrypted
    const encrypted = { url: "mxc://e/enc", key: {}, iv: "", hashes: {} };
    let decrypted: ((event: MatrixEvent) => void) | undefined;
    const event = {
      getSender: () => bot,
      getType: () => "m.room.encrypted",
      getContent: () => ({
        msgtype: "m.video",
        body: "secret.webm",
        file: encrypted,
        info: { thumbnail_file: encrypted },
      }),
      getId: () => "$3",
      once: (_name: string, f: (event: MatrixEvent) => void) => {
        decrypted = f;
      },
    } as unknown as MatrixEvent;
    room.emit(RoomEvent.Timeline, event, room, false, false, null!);
    expect(r.uploads$.value).toHaveLength(1);
    decrypted!(event);
    expect(r.uploads$.value).toEqual([
      {
        eventId: "$2",
        msgtype: "m.video",
        body: "call.webm",
        file: { url: "mxc://e/v" },
        thumbnail: { url: "mxc://e/t" },
      },
      {
        eventId: "$3",
        msgtype: "m.video",
        body: "secret.webm",
        file: { url: "mxc://e/enc", encrypted },
        thumbnail: { url: "mxc://e/enc", encrypted },
      },
    ]);
  });
});
