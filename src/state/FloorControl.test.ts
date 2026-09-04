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
      hidden: false,
      pinned: false,
      explicit: false,
    });
    expect(fc.moderation$("@bob:e:B", "@bob:e").value).toEqual({
      audioMuted: false,
      videoMuted: true,
      volume: 0.5,
      hidden: false,
      pinned: false,
      explicit: true,
    });
    // Moderators are subject to the defaults like anyone else
    expect(fc.moderation$("@mod:e:M", "@mod:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
      volume: 0.5,
      hidden: false,
      pinned: false,
      explicit: false,
    });
  });

  it("merges changes into the existing event and tracks updates", async () => {
    const { room, sendStateEvent } = setup(
      { devices: { "@bob:e:B": { video_muted: true } } },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    const bob$ = fc.moderation$("@bob:e:B", "@bob:e");
    await fc.moderator$("@bob:e:B", "@bob:e").value!.setAudioMuted(true);
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
      hidden: false,
      pinned: false,
      explicit: true,
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

  it("lets moderators pin a device for everyone", async () => {
    const { room, sendStateEvent } = setup(undefined, ["@mod:e"]);
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    await fc.moderator$("@bob:e:B", "@bob:e").value!.setPinned(true);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      FloorControlEventType,
      { devices: { "@bob:e:B": { pinned: true } } },
      slot,
    );
    room.emit(RoomStateEvent.Update, null!);
    expect(fc.moderation$("@bob:e:B", "@bob:e").value.pinned).toBe(true);
  });

  it("drops a device's entry once it's back to the defaults", async () => {
    const { room, sendStateEvent } = setup(
      {
        defaults: { audio_muted: true },
        devices: { "@bob:e:B": { audio_muted: false, video_muted: true } },
      },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    const bob = fc.moderator$("@bob:e:B", "@bob:e").value!;
    // Unmuting video leaves only the audio override, which differs from the
    // default so it stays
    await bob.setVideoMuted(false);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      FloorControlEventType,
      {
        defaults: { audio_muted: true },
        devices: { "@bob:e:B": { audio_muted: false } },
      },
      slot,
    );
    room.emit(RoomStateEvent.Update, null!);
    // Muting audio again matches the default, so the entry goes entirely
    await bob.setAudioMuted(true);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      FloorControlEventType,
      { defaults: { audio_muted: true } },
      slot,
    );
    room.emit(RoomStateEvent.Update, null!);
    expect(fc.moderation$("@bob:e:B", "@bob:e").value.explicit).toBe(false);
  });

  it("drops a device's entry once its volume is back to 1x", async () => {
    const { room, sendStateEvent } = setup(
      { devices: { "@bob:e:B": { volume: 32768 } } },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    await fc.moderator$("@bob:e:B", "@bob:e").value!.setVolume(1);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      FloorControlEventType,
      {},
      slot,
    );
  });

  it("keeps a moderator's own entry, since defaults don't apply to them", async () => {
    const { room, sendStateEvent } = setup(
      { defaults: { audio_muted: true } },
      ["@mod:e", "@peer:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    await fc.moderator$("@peer:e:P", "@peer:e").value!.setAudioMuted(true);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      FloorControlEventType,
      {
        defaults: { audio_muted: true },
        devices: { "@peer:e:P": { audio_muted: true } },
      },
      slot,
    );
  });

  it("applies an entry for all of a user's devices, under any specific one", () => {
    const { room } = setup(
      {
        devices: {
          "@alice:e:*": { hidden: true, audio_muted: true },
          "@alice:e:A": { audio_muted: false },
        },
      },
      ["@mod:e"],
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    const a = fc.moderation$("@alice:e:A", "@alice:e").value;
    expect([a.hidden, a.audioMuted, a.explicit]).toEqual([true, false, true]);
    const b = fc.moderation$("@alice:e:B", "@alice:e").value;
    expect([b.hidden, b.audioMuted, b.explicit]).toEqual([true, true, true]);
    expect(fc.moderation$("@bob:e:B", "@bob:e").value.hidden).toBe(false);
  });

  it("hides users below the auditorium power level", async () => {
    const { room, sendStateEvent } = setup(
      { auditorium_visibility: 50 },
      ["@mod:e"],
      { "@mod:e": 100, "@bob:e": 50 },
    );
    const fc = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(fc.moderation$("@alice:e:A", "@alice:e").value.hidden).toBe(true);
    expect(fc.moderation$("@bob:e:B", "@bob:e").value.hidden).toBe(false);
    expect(fc.moderation$("@mod:e:M", "@mod:e").value.hidden).toBe(false);
    await fc.setAuditoriumVisibility(undefined);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      FloorControlEventType,
      {},
      slot,
    );
  });

  it("gives non-moderators no controls", () => {
    const { room } = setup(undefined, []);
    const fc = createFloorControl(testScope(), room, "@alice:e", slot);
    expect(fc.canModerate$.value).toBe(false);
    expect(fc.moderator$("@bob:e:B", "@bob:e").value).toBe(null);
  });
});
