/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  EventType,
  type Room as MatrixRoom,
  RoomEvent,
  RoomStateEvent,
  type StateEvents,
} from "matrix-js-sdk";
import { KnownMembership } from "matrix-js-sdk/lib/types";

import { type Behavior, computed, fromEvents } from "./Behavior.ts";
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

export interface Recording {
  /** The recording in progress, if any. */
  recording$: Behavior<RecordingState | null>;
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
    toggle$: computed(() =>
      recorder !== undefined && floorControl.canRecord$.value ? toggle : null,
    ),
  };
}
