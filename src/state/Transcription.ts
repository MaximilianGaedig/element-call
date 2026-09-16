/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  EventType,
  type MatrixEvent,
  MatrixEventEvent,
  RelationType,
  type Room as MatrixRoom,
  RoomEvent,
  RoomStateEvent,
  type StateEvents,
} from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior, computed, fromEvents, state } from "./Behavior.ts";
import { type FloorControl, TranscriptionEventType } from "./FloorControl.ts";
import { type Scope } from "./Scope.ts";
import { inviteBot } from "./Recording.ts";

// Transcription (closed captions): a state event, keyed by slot, through
// which a user asks a transcriber bot to caption the call. The bot posts a
// notice referencing the request and roots a thread on it, in which each
// spoken segment lands as a reply; those replies are the captions.

/** Empty content, or no transcriber, means the call isn't being captioned. */
export interface TranscriptionEventContent {
  transcriber?: string;
}

/** A transcription that is in progress. */
export interface TranscriptionState {
  /** The user who asked for it. */
  by: string;
  transcriber: string;
  /** The event that started it. */
  eventId: string;
  /** The bot's notice that roots the transcript thread, once it's posted. */
  rootId: string | null;
}

export interface Transcription {
  /** The transcription in progress, if any. */
  transcription$: Behavior<TranscriptionState | null>;
  /** The transcript so far: the bot's thread replies, oldest first. */
  segments$: Behavior<MatrixEvent[]>;
  /**
   * Starts a transcription, or stops the one in progress. Null if the local
   * user may not transcribe or no transcriber is configured.
   */
  toggle$: Behavior<(() => Promise<void>) | null>;
}

/**
 * @param transcriber The user ID of the bot to ask for captions, if this
 *   deployment has one.
 */
export function createTranscription(
  scope: Scope,
  room: MatrixRoom,
  floorControl: FloorControl,
  slotId: string,
  transcriber: string | undefined,
): Transcription {
  const event$ = fromEvents(
    scope,
    room,
    [
      RoomEvent.CurrentStateUpdated,
      RoomStateEvent.Update,
      RoomStateEvent.Events,
    ],
    (room) => room!.currentState.getStateEvents(TranscriptionEventType, slotId),
  );
  // The bot's thread root, by the request it answers
  const roots$ = state<Record<string, string>>({});
  // Thread replies, by root
  const replies$ = state<Record<string, MatrixEvent[]>>({});
  const transcription$ = computed<TranscriptionState | null>(() => {
    const event = event$.value;
    const content = event?.getContent() as
      | TranscriptionEventContent
      | undefined;
    if (!event || content?.transcriber === undefined) return null;
    const eventId = event.getId()!;
    return {
      by: event.getSender()!,
      transcriber: content.transcriber,
      eventId,
      rootId: roots$.value[eventId] ?? null,
    };
  });
  const segments$ = computed(() => {
    const rootId = transcription$.value?.rootId;
    return rootId == null ? [] : (replies$.value[rootId] ?? []);
  });

  const onBotEvent = (event: MatrixEvent): void => {
    if (event.getType() !== EventType.RoomMessage) return;
    const relation = event.getRelation();
    if (relation?.rel_type === RelationType.Reference && relation.event_id) {
      roots$.value = { ...roots$.value, [relation.event_id]: event.getId()! };
    } else if (
      relation?.rel_type === RelationType.Thread &&
      relation.event_id
    ) {
      const root = relation.event_id;
      replies$.value = {
        ...replies$.value,
        [root]: [...(replies$.value[root] ?? []), event],
      };
    }
  };
  const onTimeline = (
    event: MatrixEvent,
    _room: unknown,
    toStart?: boolean,
  ): void => {
    if (toStart || event.getSender() !== transcriber) return;
    // In encrypted rooms the event arrives before it's decrypted
    if (event.getType() === EventType.RoomMessageEncrypted)
      event.once(MatrixEventEvent.Decrypted, onBotEvent);
    else onBotEvent(event);
  };
  room.on(RoomEvent.Timeline, onTimeline);
  scope.onEnd(() => room.off(RoomEvent.Timeline, onTimeline));

  const send = async (content: TranscriptionEventContent): Promise<void> => {
    await room.client.sendStateEvent(
      room.roomId,
      TranscriptionEventType as keyof StateEvents,
      content as StateEvents[keyof StateEvents],
      slotId,
    );
  };
  const toggle = async (): Promise<void> => {
    try {
      if (transcription$.peek() !== null) {
        await send({});
      } else {
        await inviteBot(room, transcriber!);
        await send({ transcriber: transcriber! });
      }
    } catch (e) {
      logger.error("Failed to start or stop transcription", e);
    }
  };

  return {
    transcription$,
    segments$,
    toggle$: computed(() =>
      transcriber !== undefined && floorControl.canTranscribe$.value
        ? toggle
        : null,
    ),
  };
}
