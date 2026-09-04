/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  EventType,
  type Room as MatrixRoom,
  RoomEvent,
  type RoomState,
  RoomStateEvent,
  type StateEvents,
} from "matrix-js-sdk";
import { KnownMembership } from "matrix-js-sdk/lib/types";

import { type Behavior, computed, fromEvents } from "./Behavior.ts";
import { type Scope } from "./Scope.ts";

// Floor control: a room state event through which moderators mute other
// devices in the call. See docs/floor_control_msc.md.

export const FloorControlEventType = "org.matrix.rtc.floor_control";

/**
 * Matrix events can't carry floats, so volumes are integers with this many
 * units to a multiplier of 1.
 */
export const volumeUnit = 65536;

/** What floor control asks of one device, or of all devices by default. */
export interface DeviceControlContent {
  audio_muted?: boolean;
  video_muted?: boolean;
  /**
   * A multiplier to apply to the device's audio, in units of volumeUnit:
   * 0 is silent, 65536 is unchanged. Higher is louder, but clients need not
   * honour more than twice that.
   */
  volume?: number;
}

export interface FloorControlContent {
  defaults?: DeviceControlContent;
  /** Keyed by media ID: `${userId}:${deviceId}`. */
  devices?: Record<string, DeviceControlContent>;
  /**
   * Auditorium mode: the power level a user needs for their tile to be shown
   * at all. Unset means everyone is shown.
   */
  auditorium_visibility?: number;
}

/** What floor control asks of a device, with the defaults applied. */
export interface Moderation {
  audioMuted: boolean;
  videoMuted: boolean;
  /** A multiplier to apply to the device's audio, if a moderator set one. */
  volume: number | undefined;
  /** Whether the device's tile is hidden by auditorium mode. */
  hidden: boolean;
}

export const unmoderated: Moderation = {
  audioMuted: false,
  videoMuted: false,
  volume: undefined,
  hidden: false,
};

/** Actions a moderator can take on a device. */
export interface ModeratorControls {
  setAudioMuted: (muted: boolean) => Promise<void>;
  setVideoMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

/** Actions a moderator can take on a user's room membership. */
export interface MemberActions {
  kick: () => Promise<void>;
  ban: () => Promise<void>;
}

export interface FloorControl {
  content$: Behavior<FloorControlContent>;
  /** Whether the local user may change floor control. */
  canModerate$: Behavior<boolean>;
  /** What floor control asks of the given device. */
  moderation$: (mediaId: string, userId: string) => Behavior<Moderation>;
  /** Controls for the given device, if the local user may moderate. */
  moderator$: (mediaId: string) => Behavior<ModeratorControls | null>;
  /**
   * Kicking and banning the given user, if the local user has the power to.
   * These set the membership state event directly rather than going through
   * the kick and ban APIs, so that they work through the widget API too.
   */
  memberActions$: (userId: string) => Behavior<MemberActions | null>;
  setDevice: (mediaId: string, patch: DeviceControlContent) => Promise<void>;
  setDefaults: (patch: DeviceControlContent) => Promise<void>;
  setAuditoriumVisibility: (level: number | undefined) => Promise<void>;
  /** The room's default power level for users, for labelling levels. */
  usersDefault$: Behavior<number>;
}

export const mediaId = (userId: string, deviceId: string): string =>
  `${userId}:${deviceId}`;

const toMultiplier = (volume: number | undefined): number | undefined =>
  volume === undefined ? undefined : volume / volumeUnit;

const stateEvents = [
  RoomEvent.CurrentStateUpdated,
  RoomStateEvent.Update,
  RoomStateEvent.Events,
];

/**
 * @param slotId The MatrixRTC slot (`{application}#{id}`) the call runs in;
 *   floor control is per slot, keyed by it.
 */
export function createFloorControl(
  scope: Scope,
  room: MatrixRoom,
  localUserId: string,
  slotId: string,
): FloorControl {
  const read = <T>(f: (state: RoomState) => T): Behavior<T> =>
    fromEvents(scope, room, stateEvents, (room) => f(room.currentState));

  const content$ = read(
    (state) =>
      (state.getStateEvents(FloorControlEventType, slotId)?.getContent() as
        | FloorControlContent
        | undefined) ?? {},
  );
  const mayModerate$ = read(
    (state) => (userId: string) =>
      state.maySendStateEvent(FloorControlEventType, userId),
  );
  const canModerate$ = computed(() => mayModerate$.value(localUserId));
  const usersDefault$ = read(
    (state) =>
      (state.getStateEvents(EventType.RoomPowerLevels, "")?.getContent()
        .users_default as number | undefined) ?? 0,
  );
  const powerLevel$ = read(
    (state) => (userId: string) => state.getMember(userId)?.powerLevel,
  );
  // Whether the local user outranks the given user and may kick or ban
  const mayRemove$ = read((state) => {
    const localLevel = state.getMember(localUserId)?.powerLevel ?? 0;
    return (userId: string, action: "kick" | "ban"): boolean =>
      userId !== localUserId &&
      state.hasSufficientPowerLevelFor(action, localLevel) &&
      (state.getMember(userId)?.powerLevel ?? 0) < localLevel;
  });
  const setMembership = async (
    userId: string,
    membership: KnownMembership,
  ): Promise<void> => {
    await room.client.sendStateEvent(
      room.roomId,
      EventType.RoomMember,
      { membership },
      userId,
    );
  };

  const send = async (content: FloorControlContent): Promise<void> => {
    // The SDK types state events by the spec's known types; ours is a custom
    // (draft MSC) type, so it has to be smuggled past those types
    await room.client.sendStateEvent(
      room.roomId,
      FloorControlEventType as keyof StateEvents,
      content as StateEvents[keyof StateEvents],
      slotId,
    );
  };

  const setDevice = async (
    id: string,
    patch: DeviceControlContent,
  ): Promise<void> => {
    const content = content$.peek();
    await send({
      ...content,
      devices: {
        ...content.devices,
        [id]: { ...content.devices?.[id], ...patch },
      },
    });
  };
  const setDefaults = async (patch: DeviceControlContent): Promise<void> => {
    const content = content$.peek();
    await send({ ...content, defaults: { ...content.defaults, ...patch } });
  };
  const setAuditoriumVisibility = async (
    level: number | undefined,
  ): Promise<void> => {
    const content = { ...content$.peek() };
    if (level === undefined) delete content.auditorium_visibility;
    else content.auditorium_visibility = level;
    await send(content);
  };

  return {
    content$,
    canModerate$,
    moderation$: (id, userId) =>
      computed(() => {
        const {
          defaults,
          devices,
          auditorium_visibility: visibility,
        } = content$.value;
        const device = devices?.[id];
        return {
          audioMuted: device?.audio_muted ?? defaults?.audio_muted ?? false,
          videoMuted: device?.video_muted ?? defaults?.video_muted ?? false,
          volume: toMultiplier(device?.volume ?? defaults?.volume),
          hidden:
            visibility !== undefined &&
            (powerLevel$.value(userId) ?? usersDefault$.value) < visibility,
        };
      }),
    moderator$: (id) =>
      computed(() =>
        canModerate$.value
          ? {
              setAudioMuted: async (muted) =>
                setDevice(id, { audio_muted: muted }),
              setVideoMuted: async (muted) =>
                setDevice(id, { video_muted: muted }),
              setVolume: async (volume) =>
                setDevice(id, { volume: Math.round(volume * volumeUnit) }),
            }
          : null,
      ),
    memberActions$: (userId) =>
      computed(() => {
        const mayRemove = mayRemove$.value;
        const kick = mayRemove(userId, "kick");
        const ban = mayRemove(userId, "ban");
        return kick || ban
          ? {
              kick: async () => {
                if (kick) await setMembership(userId, KnownMembership.Leave);
              },
              ban: async () => {
                if (ban) await setMembership(userId, KnownMembership.Ban);
              },
            }
          : null;
      }),
    setDevice,
    setDefaults,
    setAuditoriumVisibility,
    usersDefault$,
  };
}
