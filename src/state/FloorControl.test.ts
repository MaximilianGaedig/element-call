/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixEvent, RoomStateEvent, type Room } from "matrix-js-sdk";

import {
  createFloorControl,
  type FloorControlContent,
  FloorControlEventType,
} from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";

function setup(
  content: FloorControlContent | undefined,
  moderators: string[],
): { room: Room; sendStateEvent: ReturnType<typeof vi.fn> } {
  let current = content;
  const sendStateEvent = vi.fn();
  sendStateEvent.mockImplementation(async (_r, _t, c) => {
    current = c as FloorControlContent;
    return Promise.resolve({});
  });
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    client: { sendStateEvent },
    currentState: {
      getStateEvents: (type: string, key: string) =>
        type === FloorControlEventType && key === slot && current !== undefined
          ? ({ getContent: () => current } as unknown as MatrixEvent)
          : null,
      maySendStateEvent: (_type: string, userId: string) =>
        moderators.includes(userId),
    },
  } as unknown as Room;
  return { room, sendStateEvent };
}

const slot = "m.call#ROOM";

describe("createFloorControl", () => {
  it("applies explicit controls over defaults, to everyone", () => {
    const { room } = setup(
      {
        defaults: { audio_muted: true },
        devices: { "@bob:e:B": { audio_muted: false, video_muted: true } },
      },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(fc.canModerate$.value).toBe(true);
    expect(fc.moderation$("@alice:e:A", "@alice:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
    });
    expect(fc.moderation$("@bob:e:B", "@bob:e").value).toEqual({
      audioMuted: false,
      videoMuted: true,
    });
    // Moderators are subject to the defaults like anyone else
    expect(fc.moderation$("@mod:e:M", "@mod:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
    });
  });

  it("merges changes into the existing event and tracks updates", async () => {
    const { room, sendStateEvent } = setup(
      { devices: { "@bob:e:B": { video_muted: true } } },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    const bob$ = fc.moderation$("@bob:e:B", "@bob:e");
    await fc.moderator$("@bob:e:B").value!.setAudioMuted(true);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      FloorControlEventType,
      { devices: { "@bob:e:B": { video_muted: true, audio_muted: true } } },
      slot,
    );
    room.emit(RoomStateEvent.Update, null!);
    expect(bob$.value).toEqual({ audioMuted: true, videoMuted: true });
  });

  it("gives non-moderators no controls", () => {
    const { room } = setup(undefined, []);
    const fc = createFloorControl(testScope(), room, "@alice:e", slot);
    expect(fc.canModerate$.value).toBe(false);
    expect(fc.moderator$("@bob:e:B").value).toBe(null);
  });
});
