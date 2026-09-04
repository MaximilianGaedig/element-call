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
  powerLevels: Record<string, number> = {},
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
      getMember: (userId: string) => ({ powerLevel: powerLevels[userId] ?? 0 }),
      hasSufficientPowerLevelFor: (_action: string, level: number) =>
        level >= 50,
    },
  } as unknown as Room;
  return { room, sendStateEvent };
}

const slot = "m.call#ROOM";

describe("createFloorControl", () => {
  it("applies explicit controls over defaults, to everyone", () => {
    const { room } = setup(
      {
        defaults: { audio_muted: true, volume: 32768 },
        devices: { "@bob:e:B": { audio_muted: false, video_muted: true } },
      },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(fc.canModerate$.value).toBe(true);
    expect(fc.moderation$("@alice:e:A", "@alice:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
      volume: 0.5,
    });
    expect(fc.moderation$("@bob:e:B", "@bob:e").value).toEqual({
      audioMuted: false,
      videoMuted: true,
      volume: 0.5,
    });
    // Moderators are subject to the defaults like anyone else
    expect(fc.moderation$("@mod:e:M", "@mod:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
      volume: 0.5,
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
    expect(bob$.value).toEqual({
      audioMuted: true,
      videoMuted: true,
      volume: undefined,
    });
  });

  it("lets a user outranking another kick or ban them", async () => {
    const { room, sendStateEvent } = setup(undefined, [], {
      "@mod:e": 50,
      "@peer:e": 50,
    });
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(fc.memberActions$("@peer:e").value).toBe(null);
    expect(fc.memberActions$("@mod:e").value).toBe(null);
    const actions = fc.memberActions$("@alice:e").value;
    expect(actions).not.toBe(null);
    await actions!.kick();
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "leave" },
      "@alice:e",
    );
    await actions!.ban();
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "ban" },
      "@alice:e",
    );
  });

  it("gives non-moderators no controls", () => {
    const { room } = setup(undefined, []);
    const fc = createFloorControl(testScope(), room, "@alice:e", slot);
    expect(fc.canModerate$.value).toBe(false);
    expect(fc.moderator$("@bob:e:B").value).toBe(null);
  });
});
