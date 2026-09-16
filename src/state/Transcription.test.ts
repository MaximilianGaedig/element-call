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

import {
  createTranscription,
  type TranscriptionEventContent,
} from "./Transcription.ts";
import { constant } from "./Behavior.ts";
import { type FloorControl, TranscriptionEventType } from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";

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
  return {
    getType: () => "m.room.message",
    getContent: () => ({ msgtype: "m.notice", body }),
    getRelation: () => relation ?? null,
    getSender: () => sender,
    getId: () => id,
  } as unknown as MatrixEvent;
}

function setup(): {
  room: Room;
  sendStateEvent: ReturnType<typeof vi.fn>;
  set: (event: MatrixEvent | null) => void;
  receive: (event: MatrixEvent) => void;
} {
  let current: MatrixEvent | null = null;
  const sendStateEvent = vi.fn().mockResolvedValue({});
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    client: { sendStateEvent, getUserId: () => "@alice:e" },
    currentState: {
      getStateEvents: (type: string, key: string) =>
        type === TranscriptionEventType && key === slot ? current : null,
    },
    getMember: () => null,
  } as unknown as Room;
  return {
    room,
    sendStateEvent,
    set: (event) => {
      current = event;
      room.emit(RoomStateEvent.Update, null!);
    },
    receive: (event) =>
      room.emit(RoomEvent.Timeline, event, room, false, false, null!),
  };
}

const canTranscribe = {
  canTranscribe$: constant(true),
} as unknown as FloorControl;

describe("createTranscription", () => {
  it("follows the bot's thread off its notice for the request", () => {
    const { room, set, receive } = setup();
    const t = createTranscription(testScope(), room, canTranscribe, slot, bot);
    expect(t.transcription$.value).toBeNull();
    set(stateEvent("@alice:e", { transcriber: bot }, "$req"));
    expect(t.transcription$.value).toEqual({
      by: "@alice:e",
      transcriber: bot,
      eventId: "$req",
      rootId: null,
    });
    // Someone else's chatter isn't a transcript
    receive(message("$x", "hi", undefined, "@bob:e"));
    receive(
      message("$root", "Live captions are on.", {
        rel_type: "m.reference",
        event_id: "$req",
      }),
    );
    expect(t.transcription$.value?.rootId).toBe("$root");
    const seg = message("$1", "Alice: hello", {
      rel_type: "m.thread",
      event_id: "$root",
    });
    receive(seg);
    receive(
      message("$2", "Old: stuff", { rel_type: "m.thread", event_id: "$other" }),
    );
    expect(t.segments$.value).toEqual([seg]);
    // Turning it off clears the captions
    set(stateEvent("@alice:e", {}, "$off"));
    expect(t.transcription$.value).toBeNull();
    expect(t.segments$.value).toEqual([]);
  });

  it("invites the bot and sets the state, then clears it", async () => {
    const { room, set, sendStateEvent } = setup();
    const t = createTranscription(testScope(), room, canTranscribe, slot, bot);
    await t.toggle$.value!();
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "invite" },
      bot,
    );
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      TranscriptionEventType,
      { transcriber: bot },
      slot,
    );
    set(stateEvent("@alice:e", { transcriber: bot }, "$req"));
    await t.toggle$.value!();
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      TranscriptionEventType,
      {},
      slot,
    );
  });

  it("offers no toggle without a bot or the power to ask", () => {
    const { room } = setup();
    expect(
      createTranscription(testScope(), room, canTranscribe, slot, undefined)
        .toggle$.value,
    ).toBeNull();
    const cannot = {
      canTranscribe$: constant(false),
    } as unknown as FloorControl;
    expect(
      createTranscription(testScope(), room, cannot, slot, bot).toggle$.value,
    ).toBeNull();
  });
});
