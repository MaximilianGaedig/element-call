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
  /** Whether the device is pinned to the spotlight for everyone. */
  pinned?: boolean;
  /**
   * Whether the device's tile is hidden from everyone. The device still sees
   * and hears the call as normal.
   */
  hidden?: boolean;
  /**
   * Whether the device is shut out of the call: everyone treats it as not
   * being in the MatrixRTC session at all, and it must leave and stay out.
   */
  blocked?: boolean;
}

export interface FloorControlContent {
  defaults?: DeviceControlContent;
  /**
   * Keyed by media ID: `${userId}:${deviceId}`. A device ID of `*` applies to
   * all of that user's devices, with a specific device's entry taking
   * precedence field by field.
   */
  devices?: Record<string, DeviceControlContent>;
  /**
   * Auditorium mode: the power level a user needs for their tile to be shown
   * at all. Unset means everyone is shown.
   */
  auditorium_visibility?: number;
  /**
   * Whether people may dial into the call over SIP, and whether with video.
   * Unset means not at all.
   */
  sip_dial_in?: SipDialIn;
  /** The addresses at which bridges reach the call, by bridge bot user ID. */
  bridges?: Record<string, BridgeContent>;
}

export type SipDialIn = "audio" | "video";

export interface BridgeContent {
  sip?: string[];
}

/**
 * The state event through which the call is recorded (see
 * docs/call_recording_msc.md), keyed by slot. Who may record is who may
 * send it, which moderators set through the power levels.
 */
export const RecordingEventType = "org.matrix.rtc.recording";
/**
 * The state event through which a call's live transcription (closed
 * captions) is asked for, gated like recording by who may send it.
 */
export const TranscriptionEventType = "org.matrix.rtc.transcription";

/** What floor control asks of a device, with the defaults applied. */
export interface Moderation {
  audioMuted: boolean;
  videoMuted: boolean;
  /** A multiplier to apply to the device's audio, if a moderator set one. */
  volume: number | undefined;
  /** Whether the device's tile is hidden, by a moderator or auditorium mode. */
  hidden: boolean;
  /** Whether a moderator has shut the device out of the call. */
  blocked: boolean;
  /** Whether a moderator has pinned the device to the spotlight for everyone. */
  pinned: boolean;
  /**
   * Whether a moderator has set this device to anything other than what it
   * would get by default. Entries that return to the defaults are removed
   * from the event, so this is just whether the device has an entry.
   */
  explicit: boolean;
}

export const unmoderated: Moderation = {
  audioMuted: false,
  videoMuted: false,
  volume: undefined,
  hidden: false,
  blocked: false,
  pinned: false,
  explicit: false,
};

/** Actions a moderator can take on a device. */
export interface ModeratorControls {
  setAudioMuted: (muted: boolean) => Promise<void>;
  setVideoMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setPinned: (pinned: boolean) => Promise<void>;
  setHidden: (hidden: boolean) => Promise<void>;
  setBlocked: (blocked: boolean) => Promise<void>;
}

/** Actions a moderator can take on a user's room membership, where allowed. */
export interface MemberActions {
  kick: (() => Promise<void>) | null;
  ban: (() => Promise<void>) | null;
  /**
   * Makes the user a moderator by raising their power level to what floor
   * control needs, or takes that back by unsetting their power level. Set
   * only when the local user may make the change from the user's current
   * state.
   */
  setModerator: ((moderator: boolean) => Promise<void>) | null;
  /**
   * Whether making the user a moderator would put them at the local user's
   * own level, so that the local user couldn't take it back.
   */
  moderatorIrreversible: boolean;
}

interface PowerLevelsContent {
  users?: Record<string, number>;
  users_default?: number;
  events?: Record<string, number>;
  state_default?: number;
}

export interface FloorControl {
  content$: Behavior<FloorControlContent>;
  /** Whether the local user may change floor control. */
  canModerate$: Behavior<boolean>;
  /** Whether the local user may start and stop recording the call. */
  canRecord$: Behavior<boolean>;
  /** Whether the local user may start and stop transcribing the call. */
  canTranscribe$: Behavior<boolean>;
  /**
   * The power level set for recording, if the room sets one explicitly;
   * otherwise it's the state default.
   */
  recordingLevel$: Behavior<number | undefined>;
  /** Whether the local user may change the recording level. */
  canSetRecordingLevel$: Behavior<boolean>;
  /** Whether the given user may change floor control. */
  isModerator$: (userId: string) => Behavior<boolean>;
  /** What floor control asks of the given device. */
  moderation$: (mediaId: string, userId: string) => Behavior<Moderation>;
  /** Controls for the given device, if the local user may moderate. */
  moderator$: (
    mediaId: string,
    userId: string,
  ) => Behavior<ModeratorControls | null>;
  /**
   * Kicking, banning and promoting the given user to moderator, if the local
   * user has the power to. These set the state events directly rather than
   * going through the kick and ban APIs, so that they work through the widget
   * API too.
   */
  memberActions$: (userId: string) => Behavior<MemberActions | null>;
  /**
   * Changes a device's controls. Settings that match what the device would
   * get anyway are left out, and an entry with nothing left in it is
   * removed, so an entry only exists for a device set to something specific.
   */
  setDevice: (
    mediaId: string,
    userId: string,
    patch: DeviceControlContent,
  ) => Promise<void>;
  setDefaults: (patch: DeviceControlContent) => Promise<void>;
  setAuditoriumVisibility: (level: number | undefined) => Promise<void>;
  /** Sets who may record, or unsets it to fall back to the state default. */
  setRecordingLevel: (level: number | undefined) => Promise<void>;
  setSipDialIn: (mode: SipDialIn | undefined) => Promise<void>;
  setBridge: (userId: string, bridge: BridgeContent) => Promise<void>;
  /** The room's default power level for users, for labelling levels. */
  usersDefault$: Behavior<number>;
}

export const mediaId = (userId: string, deviceId: string): string =>
  `${userId}:${deviceId}`;

/** The media ID that stands for all of a user's devices. */
export const wildcardMediaId = (userId: string): string => mediaId(userId, "*");

/**
 * Whether the given device is blocked from the call by the given floor control
 * content. Blocking is only ever per device (or per user's devices), never a
 * default.
 */
export function isBlocked(
  content: FloorControlContent,
  userId: string,
  deviceId: string,
): boolean {
  return (
    deviceEntry(content.devices, mediaId(userId, deviceId), userId)?.blocked ??
    false
  );
}

/**
 * Reads whether the given device is blocked straight from room state, for
 * use before there's a call view model, such as in the lobby.
 */
export function isBlockedInRoom(
  state: RoomState,
  slotId: string,
  userId: string,
  deviceId: string,
): boolean {
  const content = state
    .getStateEvents(FloorControlEventType, slotId)
    ?.getContent() as FloorControlContent | undefined;
  return content !== undefined && isBlocked(content, userId, deviceId);
}

/**
 * The entry that applies to a device: its own, over any for all of its user's
 * devices. Undefined if there's neither.
 */
export function deviceEntry(
  devices: Record<string, DeviceControlContent> | undefined,
  id: string,
  userId: string,
): DeviceControlContent | undefined {
  const own = devices?.[id];
  const all = devices?.[wildcardMediaId(userId)];
  return own === undefined && all === undefined
    ? undefined
    : { ...all, ...own };
}

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
  const powerLevels$ = read(
    (state) =>
      (state.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ??
        {}) as PowerLevelsContent,
  );
  const usersDefault$ = computed(() => powerLevels$.value.users_default ?? 0);
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
  // Whether the local user may change whether the given user is a moderator:
  // they must be able to change power levels and outrank the user (or be
  // them: users may lower their own level), and to make someone a moderator
  // they need at least that level themselves
  const requiredLevel$ = computed(() => {
    const { events, state_default: stateDefault } = powerLevels$.value;
    // 50 is the spec's default for state_default when the event omits it
    return events?.[FloorControlEventType] ?? stateDefault ?? 50;
  });
  const maySetModerator$ = read((state) => {
    const localLevel = state.getMember(localUserId)?.powerLevel ?? 0;
    const required = requiredLevel$.value;
    return (userId: string): boolean => {
      const level = state.getMember(userId)?.powerLevel ?? 0;
      if (
        !state.maySendStateEvent(EventType.RoomPowerLevels, localUserId) ||
        (userId === localUserId ? level > localLevel : level >= localLevel)
      )
        return false;
      const moderator = state.maySendStateEvent(FloorControlEventType, userId);
      return moderator || localLevel >= required;
    };
  });
  const sendPowerLevels = async (
    content: PowerLevelsContent,
  ): Promise<void> => {
    await room.client.sendStateEvent(
      room.roomId,
      EventType.RoomPowerLevels,
      content,
      "",
    );
  };
  const setModerator = async (
    userId: string,
    moderator: boolean,
  ): Promise<void> => {
    const content = powerLevels$.peek();
    const users = { ...content.users };
    if (moderator) users[userId] = requiredLevel$.peek();
    else delete users[userId];
    await sendPowerLevels({ ...content, users });
  };
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

  // What a device gets with no entry of its own
  const baseline: DeviceControlContent = {
    audio_muted: false,
    video_muted: false,
    // No volume means 1x, so a volume dragged back to 1x is dropped too
    volume: volumeUnit,
    pinned: false,
    hidden: false,
    blocked: false,
  };
  const setDevice = async (
    id: string,
    userId: string,
    patch: DeviceControlContent,
  ): Promise<void> => {
    const content = content$.peek();
    const byDefault: DeviceControlContent = {
      ...baseline,
      ...(mayModerate$.peek()(userId) ? {} : content.defaults),
    };
    const merged: DeviceControlContent = { ...content.devices?.[id], ...patch };
    for (const key of Object.keys(merged) as (keyof DeviceControlContent)[])
      if (merged[key] === undefined || merged[key] === byDefault[key])
        delete merged[key];
    const devices = { ...content.devices };
    if (Object.keys(merged).length === 0) delete devices[id];
    else devices[id] = merged;
    const next: FloorControlContent = { ...content, devices };
    if (Object.keys(devices).length === 0) delete next.devices;
    await send(next);
  };
  const setDefaults = async (patch: DeviceControlContent): Promise<void> => {
    const content = content$.peek();
    await send({ ...content, defaults: { ...content.defaults, ...patch } });
  };
  const setField = async <K extends keyof FloorControlContent>(
    key: K,
    value: FloorControlContent[K] | undefined,
  ): Promise<void> => {
    const content = { ...content$.peek() };
    if (value === undefined) delete content[key];
    else content[key] = value;
    await send(content);
  };
  const canRecord$ = read((state) =>
    state.maySendStateEvent(RecordingEventType, localUserId),
  );
  const canTranscribe$ = read((state) =>
    state.maySendStateEvent(TranscriptionEventType, localUserId),
  );
  const recordingLevel$ = computed(
    () => powerLevels$.value.events?.[RecordingEventType],
  );
  const canSetRecordingLevel$ = read((state) =>
    state.maySendStateEvent(EventType.RoomPowerLevels, localUserId),
  );
  const setRecordingLevel = async (
    level: number | undefined,
  ): Promise<void> => {
    const content = powerLevels$.peek();
    const events = { ...content.events };
    if (level === undefined) delete events[RecordingEventType];
    else events[RecordingEventType] = level;
    await sendPowerLevels({ ...content, events });
  };

  return {
    content$,
    canModerate$,
    canRecord$,
    canTranscribe$,
    recordingLevel$,
    canSetRecordingLevel$,
    isModerator$: (userId) => computed(() => mayModerate$.value(userId)),
    moderation$: (id, userId) =>
      computed(() => {
        const {
          defaults,
          devices,
          auditorium_visibility: visibility,
        } = content$.value;
        const device = deviceEntry(devices, id, userId);
        return {
          audioMuted: device?.audio_muted ?? defaults?.audio_muted ?? false,
          videoMuted: device?.video_muted ?? defaults?.video_muted ?? false,
          volume: toMultiplier(device?.volume ?? defaults?.volume),
          hidden:
            (device?.hidden ?? defaults?.hidden ?? false) ||
            (visibility !== undefined &&
              (powerLevel$.value(userId) ?? usersDefault$.value) < visibility),
          blocked: device?.blocked ?? false,
          pinned: device?.pinned ?? false,
          explicit: device !== undefined,
        };
      }),
    moderator$: (id, userId) =>
      computed(() =>
        canModerate$.value
          ? {
              setAudioMuted: async (muted) =>
                setDevice(id, userId, { audio_muted: muted }),
              setVideoMuted: async (muted) =>
                setDevice(id, userId, { video_muted: muted }),
              setVolume: async (volume) =>
                setDevice(id, userId, {
                  volume: Math.round(volume * volumeUnit),
                }),
              setPinned: async (pinned) => setDevice(id, userId, { pinned }),
              setHidden: async (hidden) => setDevice(id, userId, { hidden }),
              setBlocked: async (blocked) => setDevice(id, userId, { blocked }),
            }
          : null,
      ),
    memberActions$: (userId) =>
      computed(() => {
        const mayRemove = mayRemove$.value;
        const kick = mayRemove(userId, "kick");
        const ban = mayRemove(userId, "ban");
        const moderator = maySetModerator$.value(userId);
        const localLevel = powerLevel$.value(localUserId) ?? 0;
        return kick || ban || moderator
          ? {
              kick: kick
                ? async () => setMembership(userId, KnownMembership.Leave)
                : null,
              ban: ban
                ? async () => setMembership(userId, KnownMembership.Ban)
                : null,
              setModerator: moderator
                ? async (on) => setModerator(userId, on)
                : null,
              moderatorIrreversible:
                userId !== localUserId && requiredLevel$.value >= localLevel,
            }
          : null;
      }),
    setDevice,
    setDefaults,
    setAuditoriumVisibility: async (level) =>
      setField("auditorium_visibility", level),
    setRecordingLevel,
    setSipDialIn: async (mode) => setField("sip_dial_in", mode),
    setBridge: async (userId, bridge) =>
      setField("bridges", { ...content$.peek().bridges, [userId]: bridge }),
    usersDefault$,
  };
}
