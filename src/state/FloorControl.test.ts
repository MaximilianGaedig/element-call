/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixEvent, RoomStateEvent, type Room } from "matrix-js-sdk";

import {
  createFloorControl,
  isBlocked,
  type FloorControlContent,
  FloorControlEventType,
  RecordingEventType,
  TranscriptionEventType,
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
          : type === "m.room.power_levels"
            ? ({
                getContent: () => ({
                  users: powerLevels,
                  events: { [FloorControlEventType]: 50 },
                }),
              } as unknown as MatrixEvent)
            : null,
      maySendStateEvent: (type: string, userId: string) =>
        type === "m.room.power_levels"
          ? (powerLevels[userId] ?? 0) >= 100
          : moderators.includes(userId),
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
      blocked: false,
      pinned: false,
      explicit: false,
    });
    expect(fc.moderation$("@bob:e:B", "@bob:e").value).toEqual({
      audioMuted: false,
      videoMuted: true,
      volume: 0.5,
      hidden: false,
      blocked: false,
      pinned: false,
      explicit: true,
    });
    // Moderators are subject to the defaults like anyone else
    expect(fc.moderation$("@mod:e:M", "@mod:e").value).toEqual({
      audioMuted: true,
      videoMuted: false,
      volume: 0.5,
      hidden: false,
      blocked: false,
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
      blocked: false,
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
    await actions!.kick!();
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "leave" },
      "@alice:e",
    );
    await actions!.ban!();
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

  it("reports blocked devices, including through the wildcard", () => {
    const content = {
      devices: {
        "@alice:e:A": { blocked: true },
        "@bob:e:*": { blocked: true },
      },
    };
    expect(isBlocked(content, "@alice:e", "A")).toBe(true);
    expect(isBlocked(content, "@alice:e", "B")).toBe(false);
    expect(isBlocked(content, "@bob:e", "anything")).toBe(true);
    expect(isBlocked({}, "@alice:e", "A")).toBe(false);
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

  it("lets a user who can set power levels make and unmake moderators", async () => {
    const { room, sendStateEvent } = setup(undefined, ["@admin:e", "@mod:e"], {
      "@admin:e": 100,
      "@mod:e": 50,
    });
    const admin = createFloorControl(testScope(), room, "@admin:e", slot);
    // Yourself, you may only unmake
    await admin.memberActions$("@admin:e").value!.setModerator!(false);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      "m.room.power_levels",
      { users: { "@mod:e": 50 }, events: { [FloorControlEventType]: 50 } },
      "",
    );
    await admin.memberActions$("@alice:e").value!.setModerator!(true);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      "m.room.power_levels",
      {
        users: { "@admin:e": 100, "@mod:e": 50, "@alice:e": 50 },
        events: { [FloorControlEventType]: 50 },
      },
      "",
    );
    await admin.memberActions$("@mod:e").value!.setModerator!(false);
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      "m.room.power_levels",
      { users: { "@admin:e": 100 }, events: { [FloorControlEventType]: 50 } },
      "",
    );
    // A moderator who can't change power levels can't do either
    const mod = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(mod.memberActions$("@alice:e").value?.setModerator ?? null).toBe(
      null,
    );
  });

  it("warns when a promotion couldn't be taken back", () => {
    const { room } = setup(undefined, ["@admin:e", "@mod:e"], {
      "@admin:e": 100,
      "@mod:e": 50,
    });
    // An admin outranks a moderator, so can demote them again
    const admin = createFloorControl(testScope(), room, "@admin:e", slot);
    expect(admin.memberActions$("@alice:e").value!.moderatorIrreversible).toBe(
      false,
    );
    // A moderator who can set power levels would make an equal
    const mod = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(mod.memberActions$("@alice:e").value!.moderatorIrreversible).toBe(
      true,
    );
  });

  it("says which users are moderators", () => {
    const { room } = setup(undefined, ["@mod:e"]);
    const fc = createFloorControl(testScope(), room, "@alice:e", slot);
    expect(fc.isModerator$("@mod:e").value).toBe(true);
    expect(fc.isModerator$("@alice:e").value).toBe(false);
  });
});

describe("recording level", () => {
  it("reports who may record and sets the level in the power levels", async () => {
    const { room, sendStateEvent } = setup({}, ["@mod:e"], {
      "@mod:e": 100,
      "@alice:e": 10,
    });
    const mod = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(mod.canRecord$.value).toBe(true);
    expect(mod.canSetRecordingLevel$.value).toBe(true);
    expect(mod.recordingLevel$.value).toBeUndefined();
    const alice = createFloorControl(testScope(), room, "@alice:e", slot);
    expect(alice.canRecord$.value).toBe(false);
    expect(alice.canSetRecordingLevel$.value).toBe(false);
    await mod.setRecordingLevel(10);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.power_levels",
      {
        users: { "@mod:e": 100, "@alice:e": 10 },
        events: { [FloorControlEventType]: 50, [RecordingEventType]: 10 },
      },
      "",
    );
  });

  it("sets who may have the call captioned the same way", async () => {
    const { room, sendStateEvent } = setup({}, ["@mod:e"], { "@mod:e": 100 });
    const mod = createFloorControl(testScope(), room, "@mod:e", slot);
    expect(mod.transcriptionLevel$.value).toBeUndefined();
    await mod.setTranscriptionLevel(0);
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.power_levels",
      {
        users: { "@mod:e": 100 },
        events: { [FloorControlEventType]: 50, [TranscriptionEventType]: 0 },
      },
      "",
    );
  });
});
