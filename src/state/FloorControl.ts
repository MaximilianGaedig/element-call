/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type Room as MatrixRoom,
  RoomEvent,
  type RoomState,
  RoomStateEvent,
  type StateEvents,
} from "matrix-js-sdk";

import { type Behavior, computed, fromEvents } from "./Behavior.ts";
import { type Scope } from "./Scope.ts";

// Floor control: a room state event through which moderators mute other
// devices in the call. See docs/floor_control_msc.md.

export const FloorControlEventType = "org.matrix.rtc.floor_control";

/** What floor control asks of one device, or of all devices by default. */
export interface DeviceControlContent {
  audio_muted?: boolean;
  video_muted?: boolean;
  /** A multiplier from 0 to 1 to apply to the device's audio. */
  volume?: number;
}

export interface FloorControlContent {
  defaults?: DeviceControlContent;
  /** Keyed by media ID: `${userId}:${deviceId}`. */
  devices?: Record<string, DeviceControlContent>;
}

/** What floor control asks of a device, with the defaults applied. */
export interface Moderation {
  audioMuted: boolean;
  videoMuted: boolean;
  /** A multiplier to apply to the device's audio, if a moderator set one. */
  volume: number | undefined;
}

export const unmoderated: Moderation = {
  audioMuted: false,
  videoMuted: false,
  volume: undefined,
};

/** Actions a moderator can take on a device. */
export interface ModeratorControls {
  setAudioMuted: (muted: boolean) => Promise<void>;
  setVideoMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

export interface FloorControl {
  content$: Behavior<FloorControlContent>;
  /** Whether the local user may change floor control. */
  canModerate$: Behavior<boolean>;
  /** What floor control asks of the given device. */
  moderation$: (mediaId: string, userId: string) => Behavior<Moderation>;
  /** Controls for the given device, if the local user may moderate. */
  moderator$: (mediaId: string) => Behavior<ModeratorControls | null>;
  setDevice: (mediaId: string, patch: DeviceControlContent) => Promise<void>;
  setDefaults: (patch: DeviceControlContent) => Promise<void>;
}

export const mediaId = (userId: string, deviceId: string): string =>
  `${userId}:${deviceId}`;

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

  return {
    content$,
    canModerate$,
    moderation$: (id, userId) =>
      computed(() => {
        const { defaults, devices } = content$.value;
        const device = devices?.[id];
        return {
          audioMuted: device?.audio_muted ?? defaults?.audio_muted ?? false,
          videoMuted: device?.video_muted ?? defaults?.video_muted ?? false,
          volume: device?.volume ?? defaults?.volume,
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
              setVolume: async (volume) => setDevice(id, { volume }),
            }
          : null,
      ),
    setDevice,
    setDefaults,
  };
}
