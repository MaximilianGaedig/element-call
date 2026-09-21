/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import {
  ClientEvent,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

import {
  createTranscription,
  StreamUpdateType,
  type TranscriptionEventContent,
  TranscriptionSpeakerField,
} from "./Transcription.ts";
import { constant } from "./Behavior.ts";
import {
  type FloorControl,
  TranscriptionEventType,
  TranscriptionStatusEventType,
  TranscriptionSubscribeEventType,
} from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";
import { E2eeType } from "../e2ee/e2eeType.ts";

const unencrypted = { kind: E2eeType.NONE } as const;

const slot = "m.call#ROOM";
const bot = "@bot:e";

function stateEvent(
  sender: string,
  content: TranscriptionEventContent,
  id: string,
): MatrixEvent {
  return {
    getContent: () => content,
    getSender: () => sender,
    getId: () => id,
  } as unknown as MatrixEvent;
}

function message(
  id: string,
  body: string,
  relation?: { rel_type: string; event_id: string },
  sender = bot,
): MatrixEvent {
  const content: Record<string, unknown> = { msgtype: "m.notice", body };
  if (relation?.rel_type === "m.replace")
    content["m.new_content"] = { msgtype: "m.notice", body: body.slice(2) };
  return messageWith(id, content, relation, sender);
}

function messageWith(
  id: string,
  content: Record<string, unknown>,
  relation?: { rel_type: string; event_id: string },
  sender = bot,
): MatrixEvent {
  return {
    getType: () => "m.room.message",
    getContent: () => content,
    getRelation: () => relation ?? null,
    getSender: () => sender,
    getId: () => id,
    getTs: () => 0,
  } as unknown as MatrixEvent;
}

function toDeviceEvent(
  type: string,
  content: Record<string, unknown>,
  encrypted = true,
  sender = bot,
): MatrixEvent {
  return {
    getType: () => type,
    getContent: () => content,
    getSender: () => sender,
    isEncrypted: () => encrypted,
  } as unknown as MatrixEvent;
}

/** An update of a stream with no event behind it. */
function privateUpdate(
  streamId: string,
  seq: number,
  op: string,
  content: Record<string, unknown>,
  encrypted = true,
): MatrixEvent {
  return toDeviceEvent(
    StreamUpdateType,
    { room_id: "!room", stream_id: streamId, seq, op, content },
    encrypted,
  );
}

function update(
  eventId: string,
  seq: number,
  body: string,
  op = "append",
  sender = bot,
): MatrixEvent {
  return {
    getType: () => StreamUpdateType,
    getContent: () => ({
      room_id: "!room",
      event_id: eventId,
      seq,
      op,
      content: { body },
    }),
    getSender: () => sender,
    isEncrypted: () => false,
  } as unknown as MatrixEvent;
}

function setup(history: MatrixEvent[] = []): {
  room: Room;
  sendStateEvent: ReturnType<typeof vi.fn>;
  /** What was Olm-encrypted for the bot's devices. */
  encrypt: ReturnType<typeof vi.fn>;
  set: (event: MatrixEvent | null) => void;
  receive: (event: MatrixEvent) => void;
  toDevice: (event: MatrixEvent) => void;
} {
  let current: MatrixEvent | null = null;
  const sendStateEvent = vi.fn().mockResolvedValue({});
  const encrypt = vi.fn().mockResolvedValue({});
  const client = {
    ...mockEmitter(),
    sendStateEvent,
    getUserId: () => "@alice:e",
    getCrypto: () => ({
      getUserDeviceInfo: async () =>
        Promise.resolve(new Map([[bot, new Map([["BOTDEV", {}]])]])),
      encryptToDeviceMessages: encrypt,
    }),
    queueToDevice: vi.fn().mockResolvedValue(undefined),
  };
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    client,
    currentState: {
      getStateEvents: (type: string, key: string) =>
        type === TranscriptionEventType && key === slot ? current : null,
    },
    getMember: (id: string) => (id === "@bob:e" ? { name: "Bob" } : null),
    getLiveTimeline: () => ({ getEvents: () => history }),
  } as unknown as Room;
  return {
    room,
    sendStateEvent,
    encrypt,
    set: (event) => {
      current = event;
      room.emit(RoomStateEvent.Update, null!);
    },
    receive: (event) =>
      room.emit(RoomEvent.Timeline, event, room, false, false, null!),
    toDevice: (event) => client.emit(ClientEvent.ToDeviceEvent, event),
  };
}

const canTranscribe = {
  canTranscribe$: constant(true),
} as unknown as FloorControl;

describe("createTranscription", () => {
  it("follows the thread the bot names in the state", () => {
    const { room, set, receive } = setup();
    const t = createTranscription(
      testScope(),
      room,
      canTranscribe,
      slot,
      bot,
      unencrypted,
    );
    expect(t.transcription$.value).toBeNull();
    set(stateEvent("@alice:e", { transcriber: bot }, "$req"));
    expect(t.transcription$.value).toEqual({ transcriber: bot, rootId: null });
    // Someone else's chatter isn't a transcript
    receive(message("$x", "hi", undefined, "@bob:e"));
    set(stateEvent(bot, { transcriber: bot, root: "$root" }, "$named"));
    expect(t.transcription$.value?.rootId).toBe("$root");
    const seg = message("$1", "Alice: hello", {
      rel_type: "m.thread",
      event_id: "$root",
    });
    receive(seg);
    receive(
      message("$2", "Old: stuff", { rel_type: "m.thread", event_id: "$other" }),
    );
    // Named speakers are shown under their room name
    const named = messageWith(
      "$3",
      {
        msgtype: "m.notice",
        body: "Bob: hi",
        [TranscriptionSpeakerField]: "@bob:e",
      },
      { rel_type: "m.thread", event_id: "$root" },
    );
    receive(named);
    expect(t.segments$.value).toEqual([
      { event: seg, body: "Alice: hello", speaker: undefined },
      { event: named, body: "Bob: hi", speaker: "Bob" },
    ]);
    // Turning it off clears the captions
    set(stateEvent("@alice:e", {}, "$off"));
    expect(t.transcription$.value).toBeNull();
    expect(t.segments$.value).toEqual([]);
  });

  it("streams a segment's words until its edit arrives", () => {
    const { room, set, receive, toDevice } = setup();
    const t = createTranscription(
      testScope(),
      room,
      canTranscribe,
      slot,
      bot,
      unencrypted,
    );
    set(stateEvent(bot, { transcriber: bot, root: "$root" }, "$req"));
    const thread = { rel_type: "m.thread", event_id: "$root" };
    const body = (): string[] => t.segments$.value.map((c) => c.body);
    // Updates may arrive before the segment itself
    toDevice(update("$1", 1, " what I"));
    receive(message("$1", "Alice: so", thread));
    expect(body()).toEqual(["Alice: so what I"]);
    toDevice(update("$1", 2, " was saying"));
    toDevice(update("$1", 2, " was saying")); // a repeat is ignored
    toDevice(update("$1", 3, " nope", "append", "@mallory:e"));
    expect(body()).toEqual(["Alice: so what I was saying"]);
    toDevice(update("$1", 3, "Alice: replaced", "replace"));
    expect(body()).toEqual(["Alice: replaced"]);
    // The edit is final, whatever straggles in afterwards
    receive(
      message("$1e", "* Alice: so what I was saying.", {
        rel_type: "m.replace",
        event_id: "$1",
      }),
    );
    toDevice(update("$1", 4, " more"));
    expect(body()).toEqual(["Alice: so what I was saying."]);
  });

  it("subscribes this device alone, and keeps a transcript only when asked", async () => {
    const { room, sendStateEvent, encrypt, toDevice } = setup();
    const t = createTranscription(
      testScope(),
      room,
      canTranscribe,
      slot,
      bot,
      unencrypted,
    );
    const subscription = (on: boolean): unknown[] => [
      TranscriptionSubscribeEventType,
      [{ userId: bot, deviceId: "BOTDEV" }],
      { room_id: "!room", subscribe: on },
    ];
    await t.toggle$.value!();
    expect(t.captions$.value).toBe(true);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "invite" },
      bot,
    );
    expect(encrypt).toHaveBeenLastCalledWith(...subscription(true));
    // Nothing about captions is said to the room
    expect(sendStateEvent).toHaveBeenCalledTimes(1);

    await t.setTranscript$.value!(true);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      TranscriptionEventType,
      { transcriber: bot },
      slot,
    );
    await t.setTranscript$.value!(false);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      TranscriptionEventType,
      {},
      slot,
    );

    await t.toggle$.value!();
    expect(t.captions$.value).toBe(false);
    expect(encrypt).toHaveBeenLastCalledWith(...subscription(false));

    // The transcriber says when it's listening, and may refuse, or stop
    await t.toggle$.value!();
    expect(t.listening$.value).toBe(false);
    toDevice(
      toDeviceEvent(TranscriptionStatusEventType, {
        room_id: "!room",
        subscribed: true,
      }),
    );
    expect(t.listening$.value).toBe(true);
    const refusal = { room_id: "!room", subscribed: false, error: "no" };
    toDevice(toDeviceEvent(TranscriptionStatusEventType, refusal, false));
    expect(t.captions$.value).toBe(true);
    toDevice(toDeviceEvent(TranscriptionStatusEventType, refusal));
    expect(t.captions$.value).toBe(false);
  });

  it("shows segments streamed to us alone, with no transcript", () => {
    const { room, toDevice } = setup();
    const t = createTranscription(
      testScope(),
      room,
      canTranscribe,
      slot,
      bot,
      unencrypted,
    );
    const speaker = { [TranscriptionSpeakerField]: "@bob:e" };
    // In the clear it could be from anyone
    toDevice(privateUpdate("s0", 1, "replace", { body: "Bob: psst" }, false));
    expect(t.segments$.value).toEqual([]);
    toDevice(
      privateUpdate("s1", 1, "replace", { body: "Bob: so", ...speaker }),
    );
    toDevice(privateUpdate("s1", 2, "append", { body: " what I" }));
    toDevice(privateUpdate("s1", 2, "append", { body: " what I" }));
    toDevice(privateUpdate("s2", 1, "replace", { body: "Alice: yes" }));
    toDevice(
      privateUpdate("s1", 3, "replace", {
        body: "Bob: so what I said.",
        ...speaker,
      }),
    );
    expect(
      t.segments$.value.map(({ event, body, speaker }) => [
        event.getId(),
        body,
        speaker,
      ]),
    ).toEqual([
      ["s1", "Bob: so what I said.", "Bob"],
      ["s2", "Alice: yes", undefined],
    ]);
  });

  it("writes a deployment's captions-for-everyone default into the room", () => {
    const { room } = setup();
    const setTranscriptionLevel = vi.fn().mockResolvedValue(undefined);
    const floorControl = (level: number | undefined, canSet: boolean) =>
      ({
        canTranscribe$: constant(true),
        canSetRecordingLevel$: constant(canSet),
        transcriptionLevel$: constant(level),
        usersDefault$: constant(0),
        setTranscriptionLevel,
      }) as unknown as FloorControl;
    const create = (fc: FloorControl, forEveryone: boolean) =>
      createTranscription(
        testScope(),
        room,
        fc,
        slot,
        bot,
        unencrypted,
        forEveryone,
      );
    create(floorControl(undefined, true), false);
    create(floorControl(undefined, false), true);
    // A moderator's choice stands
    create(floorControl(50, true), true);
    expect(setTranscriptionLevel).not.toHaveBeenCalled();
    create(floorControl(undefined, true), true);
    expect(setTranscriptionLevel).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("offers no toggle without a bot or the power to ask", () => {
    const { room } = setup();
    expect(
      createTranscription(
        testScope(),
        room,
        canTranscribe,
        slot,
        undefined,
        unencrypted,
      ).toggle$.value,
    ).toBeNull();
    const cannot = {
      canTranscribe$: constant(false),
    } as unknown as FloorControl;
    expect(
      createTranscription(testScope(), room, cannot, slot, bot, unencrypted)
        .toggle$.value,
    ).toBeNull();
  });
});
