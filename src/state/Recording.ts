/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  EventType,
  type MatrixEvent,
  MatrixEventEvent,
  type Room as MatrixRoom,
  RoomEvent,
  RoomStateEvent,
  type StateEvents,
} from "matrix-js-sdk";
import { type EncryptedFile } from "matrix-js-sdk/lib/@types/media";
import { KnownMembership } from "matrix-js-sdk/lib/types";

import { type Behavior, computed, fromEvents, state } from "./Behavior.ts";
import { type FloorControl, RecordingEventType } from "./FloorControl.ts";
import { type Scope } from "./Scope.ts";

// Recording: a state event, keyed by slot, through which users ask a
// recorder bot to record the call, and by which everyone learns that it's
// being recorded. See docs/call_recording_msc.md.

export type RecordingMedia = "audio" | "video";
export type RecordingStreams = "composite" | "separate" | "both";

/** Empty content, or no recorder, means the call isn't being recorded. */
export interface RecordingEventContent {
  recorder?: string;
  media?: RecordingMedia;
  streams?: RecordingStreams;
}

/** A recording that is in progress. */
export interface RecordingState {
  /** The user who asked for it. */
  by: string;
  recorder: string;
  media: RecordingMedia;
  streams: RecordingStreams;
  /** The event that started it, for telling recordings apart. */
  eventId: string;
}

/** Where a piece of media is, and how to decrypt it if it's encrypted */
export interface MediaFile {
  /** mxc URL */
  url: string;
  /** The key, IV and hash, when the room is encrypted */
  encrypted?: EncryptedFile;
}

/** A finished recording the recorder has posted into the room. */
export interface RecordingUpload {
  eventId: string;
  msgtype: "m.video" | "m.audio";
  /** The file name */
  body: string;
  file: MediaFile;
  /** A thumbnail, if there is one */
  thumbnail: MediaFile | undefined;
}

function mediaFile(
  encrypted: EncryptedFile | undefined,
  url: string | undefined,
): MediaFile | undefined {
  if (encrypted?.url) return { url: encrypted.url, encrypted };
  if (url) return { url };
  return undefined;
}

export interface Recording {
  /** The recording in progress, if any. */
  recording$: Behavior<RecordingState | null>;
  /** Recordings the recorder has posted since we've been watching. */
  uploads$: Behavior<RecordingUpload[]>;
  /**
   * Starts a recording, or stops the one in progress. Null if the local
   * user may not record or no recorder is configured.
   */
  toggle$: Behavior<(() => Promise<void>) | null>;
}

/** Invites a bot into the room, unless it's already a member or invited. */
export async function inviteBot(
  room: MatrixRoom,
  userId: string,
): Promise<void> {
  const membership = room.getMember(userId)?.membership;
  if (
    membership !== KnownMembership.Join &&
    membership !== KnownMembership.Invite
  )
    await room.client.sendStateEvent(
      room.roomId,
      EventType.RoomMember,
      { membership: KnownMembership.Invite },
      userId,
    );
}

/**
 * @param recorder The user ID of the bot to ask for recordings, if this
 *   deployment has one.
 */
export function createRecording(
  scope: Scope,
  room: MatrixRoom,
  floorControl: FloorControl,
  slotId: string,
  recorder: string | undefined,
): Recording {
  const event$ = fromEvents(
    scope,
    room,
    [
      RoomEvent.CurrentStateUpdated,
      RoomStateEvent.Update,
      RoomStateEvent.Events,
    ],
    (room) => room.currentState.getStateEvents(RecordingEventType, slotId),
  );
  const recording$ = computed<RecordingState | null>(() => {
    const event = event$.value;
    const content = event?.getContent() as RecordingEventContent | undefined;
    return event && content?.recorder !== undefined
      ? {
          by: event.getSender()!,
          recorder: content.recorder,
          media: content.media ?? "video",
          streams: content.streams ?? "composite",
          eventId: event.getId()!,
        }
      : null;
  });

  // The recorder posts finished recordings into the room as media
  // messages; in the standalone app there's no timeline to see them in, so
  // collect them as they arrive
  const uploads$ = state<RecordingUpload[]>([]);
  const onUpload = (event: MatrixEvent): void => {
    const content = event.getContent();
    const msgtype = content.msgtype;
    const file = mediaFile(content.file, content.url);
    if ((msgtype !== "m.video" && msgtype !== "m.audio") || file === undefined)
      return;
    uploads$.value = [
      ...uploads$.value,
      {
        eventId: event.getId()!,
        msgtype,
        body: content.body ?? "",
        file,
        thumbnail: mediaFile(
          content.info?.thumbnail_file,
          content.info?.thumbnail_url,
        ),
      },
    ];
  };
  const onTimeline = (
    event: MatrixEvent,
    _room: unknown,
    toStart?: boolean,
  ): void => {
    if (toStart || event.getSender() !== recorder) return;
    // In encrypted rooms the event arrives before it's decrypted
    if (event.getType() === EventType.RoomMessageEncrypted)
      event.once(MatrixEventEvent.Decrypted, onUpload);
    else onUpload(event);
  };
  room.on(RoomEvent.Timeline, onTimeline);
  scope.onEnd(() => room.off(RoomEvent.Timeline, onTimeline));

  const send = async (content: RecordingEventContent): Promise<void> => {
    await room.client.sendStateEvent(
      room.roomId,
      RecordingEventType as keyof StateEvents,
      content as StateEvents[keyof StateEvents],
      slotId,
    );
  };
  const toggle = async (): Promise<void> => {
    if (recording$.peek() !== null) {
      await send({});
      return;
    }
    // toggle$ only offers this once a recorder is configured
    await inviteBot(room, recorder!);
    await send({ recorder: recorder! });
  };

  return {
    recording$,
    uploads$,
    toggle$: computed(() =>
      recorder !== undefined && floorControl.canRecord$.value ? toggle : null,
    ),
  };
}
