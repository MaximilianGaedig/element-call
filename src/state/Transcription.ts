/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  ClientEvent,
  EventType,
  MatrixEvent,
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
// spoken segment lands as a reply; those replies are the captions. While a
// segment is being spoken the bot streams its words to the devices in the
// call as MSC4471-style to-device updates, and edits the reply with the
// finished text when the speaker pauses (see docs/event_streams.md).

/** An MSC4471 stream update, sent in the clear in unencrypted rooms. */
export const StreamUpdateType = "org.matrix.msc4471.stream.update";
/** A stream update Megolm-encrypted with the room's session. */
const StreamEncryptedType = "org.matrix.msc4471.stream.encrypted";

interface StreamUpdate {
  room_id: string;
  event_id: string;
  seq: number;
  op: "replace" | "append";
  content: { body: string };
}

/** What a stream has told us about a segment's body so far. */
interface LiveBody {
  /** The whole body, from a replace or the final edit, if we have one. */
  base: string | null;
  /** Text appended since `base` (or since the segment event's own body). */
  extra: string;
  seq: number;
  /** The final edit has arrived, so later updates are stragglers. */
  done: boolean;
}

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

/** One transcript segment. */
export interface Caption {
  /** The bot's thread reply. */
  event: MatrixEvent;
  /** Its text as it stands, including words streamed since it was posted. */
  body: string;
}

export interface Transcription {
  /** The transcription in progress, if any. */
  transcription$: Behavior<TranscriptionState | null>;
  /** The transcript so far: the bot's thread replies, oldest first. */
  segments$: Behavior<Caption[]>;
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
  // Streamed words, by segment
  const live$ = state<Record<string, LiveBody>>({});
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
  const segments$ = computed<Caption[]>(() => {
    const rootId = transcription$.value?.rootId;
    const replies = rootId == null ? [] : (replies$.value[rootId] ?? []);
    return replies.map((event) => {
      const live = live$.value[event.getId()!];
      const body: string = event.getContent().body ?? "";
      return { event, body: live ? (live.base ?? body) + live.extra : body };
    });
  });

  const applyUpdate = (update: StreamUpdate): void => {
    const { event_id: id, seq, op } = update;
    const live = live$.value[id] ?? {
      base: null,
      extra: "",
      seq: 0,
      done: false,
    };
    // ponytail: an update after a gap is applied rather than dropped, since
    // the final edit sets the text straight within a couple of seconds
    if (update.room_id !== room.roomId || live.done || seq <= live.seq) return;
    live$.value = {
      ...live$.value,
      [id]:
        op === "replace"
          ? { ...live, base: update.content.body, extra: "", seq }
          : { ...live, extra: live.extra + update.content.body, seq },
    };
  };
  let streamCount = 0;
  const onToDevice = async (event: MatrixEvent): Promise<void> => {
    if (event.getSender() !== transcriber) return;
    if (event.getType() === StreamUpdateType) {
      applyUpdate(event.getContent<StreamUpdate>());
    } else if (event.getType() === StreamEncryptedType) {
      // The bot encrypted the update as a room event: rebuild it as one so
      // the crypto layer decrypts it with the room's session
      const { room_id: roomId, ...content } = event.getContent();
      if (roomId !== room.roomId) return;
      const wrapped = new MatrixEvent({
        type: EventType.RoomMessageEncrypted,
        room_id: roomId,
        sender: event.getSender(),
        event_id: `$stream${streamCount++}`,
        origin_server_ts: Date.now(),
        content,
      });
      await room.client.decryptEventIfNeeded(wrapped);
      if (wrapped.getType() === StreamUpdateType)
        applyUpdate(wrapped.getContent<StreamUpdate>());
    }
  };
  const onToDeviceSync = (event: MatrixEvent): void => {
    onToDevice(event).catch((e) =>
      logger.warn("Failed to apply a caption stream update", e),
    );
  };
  room.client.on(ClientEvent.ToDeviceEvent, onToDeviceSync);
  scope.onEnd(() => room.client.off(ClientEvent.ToDeviceEvent, onToDeviceSync));

  const onBotEvent = (event: MatrixEvent): void => {
    if (event.getType() !== EventType.RoomMessage) return;
    const relation = event.getRelation();
    if (relation?.rel_type === RelationType.Reference && relation.event_id) {
      roots$.value = { ...roots$.value, [relation.event_id]: event.getId()! };
    } else if (
      relation?.rel_type === RelationType.Replace &&
      relation.event_id
    ) {
      // The segment is finished: its edit is the last word
      const body: string =
        event.getContent()["m.new_content"]?.body ?? event.getContent().body;
      live$.value = {
        ...live$.value,
        [relation.event_id]: {
          base: body,
          extra: "",
          seq: Infinity,
          done: true,
        },
      };
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
