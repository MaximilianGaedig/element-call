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
import {
  type FloorControl,
  StreamEncryptedType,
  StreamUpdateType,
  TranscriptionEventType,
  TranscriptionStatusEventType,
  TranscriptionSubscribeEventType,
} from "./FloorControl.ts";
import { type Scope } from "./Scope.ts";
import { inviteBot, sendSharedKey, trackUser } from "./Recording.ts";
import { widget } from "../widget.ts";
import { type EncryptionSystem } from "../e2ee/sharedKeyManagement.ts";
import { E2eeType } from "../e2ee/e2eeType.ts";

// Transcription (closed captions). Captions are each device's own choice:
// a device that wants them subscribes with the transcriber bot over an
// Olm-encrypted to-device message, and the bot sends what is said to the
// subscribers alone, as Olm-encrypted stream updates that never reach the
// room. Separately, a state event keyed by slot asks the bot to keep a
// transcript in the room. The bot then posts a notice and roots a thread on
// it, in which each spoken segment lands as a reply, and names the notice
// in the state event (its `root`), since state reaches everyone in the
// call where the notice is history a late joiner may not have or be able
// to decrypt. While a segment is being spoken the bot streams its words to
// the subscribers as MSC4471-style to-device updates, and edits the reply
// with the finished text when the speaker pauses (see
// docs/event_streams.md). The bot hears the call either way, so both are
// for those with the power to send the state event.

/** Content field of a segment naming the user who spoke it. */
export const TranscriptionSpeakerField = "org.matrix.rtc.transcription.speaker";

export { StreamUpdateType };

interface StreamUpdate {
  room_id: string;
  /** The segment's event, when a transcript is being kept. */
  event_id?: string;
  /** Otherwise the stream is all there is, and this is its name. */
  stream_id?: string;
  seq: number;
  op: "replace" | "append";
  content: { body: string; [TranscriptionSpeakerField]?: string };
}

/** How many segments without a transcript to keep hold of. */
const PRIVATE_SEGMENTS = 50;

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

/** Empty content, or no transcriber, means no transcript is being kept. */
export interface TranscriptionEventContent {
  transcriber?: string;
  /** The bot's notice that roots the transcript thread, once it's posted. */
  root?: string;
}

/** A transcript that is being kept. */
export interface TranscriptionState {
  transcriber: string;
  /** The bot's notice that roots the transcript thread, once it's posted. */
  rootId: string | null;
}

/** One transcript segment. */
export interface Caption {
  /** The bot's thread reply. */
  event: MatrixEvent;
  /** Its text as it stands, including words streamed since it was posted. */
  body: string;
  /** Who spoke it, as they are known in the room, if the bot said. */
  speaker?: string;
}

export interface Transcription {
  /** The transcript being kept in the room, if any. */
  transcription$: Behavior<TranscriptionState | null>;
  /** Whether this device is showing captions. */
  captions$: Behavior<boolean>;
  /** What has been said since captions were on, oldest first. */
  segments$: Behavior<Caption[]>;
  /**
   * Turns this device's captions on or off. Null if the local user may not
   * have the call transcribed or no transcriber is configured.
   */
  toggle$: Behavior<(() => Promise<void>) | null>;
  /**
   * Starts or stops keeping a transcript in the room, for everyone. Null
   * when `toggle$` is.
   */
  setTranscript$: Behavior<((keep: boolean) => Promise<void>) | null>;
}

/**
 * @param transcriber The user ID of the bot to ask for captions, if this
 *   deployment has one.
 * @param encryptionSystem How the call is encrypted: a transcriber can only
 *   hear a call encrypted with a shared key if it's given the key.
 * @param forEveryone Whether captions are for everyone in rooms that don't
 *   say: whoever is first able to writes that into the room's power levels,
 *   which is where the transcriber looks.
 */
export function createTranscription(
  scope: Scope,
  room: MatrixRoom,
  floorControl: FloorControl,
  slotId: string,
  transcriber: string | undefined,
  encryptionSystem: EncryptionSystem,
  forEveryone = false,
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
  // Thread replies, by root
  const replies$ = state<Record<string, MatrixEvent[]>>({});
  // Streamed words, by segment
  const live$ = state<Record<string, LiveBody>>({});
  // Segments that are only a stream, no transcript being kept
  const private$ = state<Caption[]>([]);
  const captions$ = state(false);
  const transcription$ = computed<TranscriptionState | null>(() => {
    const event = event$.value;
    const content = event?.getContent() as
      | TranscriptionEventContent
      | undefined;
    if (!event || content?.transcriber === undefined) return null;
    return {
      transcriber: content.transcriber,
      rootId: typeof content.root === "string" ? content.root : null,
    };
  });
  const segments$ = computed<Caption[]>(() => {
    const rootId = transcription$.value?.rootId;
    const replies = rootId == null ? [] : (replies$.value[rootId] ?? []);
    const kept = replies.map((event) => {
      const live = live$.value[event.getId()!];
      const content = event.getContent();
      const body: string = content.body ?? "";
      const userId: unknown = content[TranscriptionSpeakerField];
      const speaker =
        typeof userId === "string"
          ? (room.getMember(userId)?.name ?? userId)
          : undefined;
      return {
        event,
        body: live ? (live.base ?? body) + live.extra : body,
        speaker,
      };
    });
    // A transcript may start or stop while we watch
    return [...private$.value, ...kept].sort(
      (a, b) => a.event.getTs() - b.event.getTs(),
    );
  });

  const speakerName = (userId: unknown): string | undefined =>
    typeof userId === "string"
      ? (room.getMember(userId)?.name ?? userId)
      : undefined;
  const privateSeq = new Map<string, number>();
  const applyPrivate = (id: string, update: StreamUpdate): void => {
    if (update.seq <= (privateSeq.get(id) ?? 0)) return;
    privateSeq.set(id, update.seq);
    const segments = private$.value;
    const old = segments.find((c) => c.event.getId() === id);
    const caption: Caption =
      update.op === "append" && old
        ? { ...old, body: old.body + update.content.body }
        : {
            event:
              old?.event ??
              new MatrixEvent({
                event_id: id,
                type: EventType.RoomMessage,
                room_id: room.roomId,
                sender: transcriber,
                origin_server_ts: Date.now(),
                content: {},
              }),
            body: update.content.body,
            speaker: speakerName(update.content[TranscriptionSpeakerField]),
          };
    private$.value = (
      old
        ? segments.map((c) => (c === old ? caption : c))
        : [...segments, caption]
    ).slice(-PRIVATE_SEGMENTS);
  };

  const applyUpdate = (update: StreamUpdate, encrypted: boolean): void => {
    if (update.room_id !== room.roomId) return;
    const { event_id: id, seq, op } = update;
    if (id === undefined) {
      // Only Olm vouches for a stream with no event behind it
      if (encrypted && update.stream_id !== undefined)
        applyPrivate(update.stream_id, update);
      return;
    }
    const live = live$.value[id] ?? {
      base: null,
      extra: "",
      seq: 0,
      done: false,
    };
    // ponytail: an update after a gap is applied rather than dropped, since
    // the final edit sets the text straight within a couple of seconds
    if (live.done || seq <= live.seq) return;
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
    if (event.getType() === TranscriptionStatusEventType) {
      const status = event.getContent<{
        room_id?: string;
        subscribed?: boolean;
        error?: string;
      }>();
      if (!event.isEncrypted() || status.room_id !== room.roomId) return;
      if (status.error) logger.warn("Captions refused:", status.error);
      if (status.subscribed === false) captions$.value = false;
    } else if (event.getType() === StreamUpdateType) {
      applyUpdate(event.getContent<StreamUpdate>(), event.isEncrypted());
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
        applyUpdate(wrapped.getContent<StreamUpdate>(), false);
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
    if (relation?.rel_type === RelationType.Replace && relation.event_id) {
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
  // Captions may have started before we got here: the segments so far are
  // in the timeline we already have
  // ponytail: only the synced window; paginate back if older ones matter
  for (const event of room.getLiveTimeline().getEvents())
    onTimeline(event, room);

  const send = async (content: TranscriptionEventContent): Promise<void> => {
    await room.client.sendStateEvent(
      room.roomId,
      TranscriptionEventType as keyof StateEvents,
      content as StateEvents[keyof StateEvents],
      slotId,
    );
  };
  const subscribe = async (on: boolean): Promise<void> =>
    sendToBot(room, transcriber!, TranscriptionSubscribeEventType, {
      room_id: room.roomId,
      subscribe: on,
    });
  const toggle = async (): Promise<void> => {
    const on = !captions$.peek();
    // Shown at once; the transcriber's answer turns them back off
    captions$.value = on;
    try {
      if (on) {
        await inviteBot(room, transcriber!);
        if (encryptionSystem.kind === E2eeType.SHARED_KEY)
          await sendSharedKey(room, transcriber!, encryptionSystem.secret);
      } else private$.value = [];
      await subscribe(on);
    } catch (e) {
      logger.error("Failed to turn captions on or off", e);
      captions$.value = false;
    }
  };
  const setTranscript = async (keep: boolean): Promise<void> => {
    try {
      await send(keep ? { transcriber: transcriber! } : {});
    } catch (e) {
      logger.error("Failed to start or stop the transcript", e);
    }
  };
  // The transcriber stops sending once we leave the call, but tell it
  scope.onEnd(() => {
    if (captions$.peek())
      subscribe(false).catch((e) =>
        logger.warn("Failed to unsubscribe from captions", e),
      );
  });

  const allowed$ = computed(
    () => transcriber !== undefined && floorControl.canTranscribe$.value,
  );
  // The transcriber goes by the room's power levels, so a deployment's
  // default has to be written there by someone who can
  scope.effect(() => {
    if (
      forEveryone &&
      transcriber !== undefined &&
      floorControl.canSetRecordingLevel$.value &&
      floorControl.transcriptionLevel$.value === undefined
    )
      floorControl
        .setTranscriptionLevel(floorControl.usersDefault$.peek())
        .catch((e) => logger.warn("Failed to open captions to everyone", e));
  });

  return {
    transcription$,
    captions$,
    segments$,
    toggle$: computed(() => (allowed$.value ? toggle : null)),
    setTranscript$: computed(() => (allowed$.value ? setTranscript : null)),
  };
}

/**
 * Sends the bot an Olm-encrypted to-device message, on all its devices. As
 * a widget the host encrypts; standalone, our own crypto does, which needs
 * to be tracking the bot.
 */
async function sendToBot(
  room: MatrixRoom,
  bot: string,
  eventType: string,
  content: Record<string, unknown>,
): Promise<void> {
  if (widget !== null) {
    await room.client.encryptAndSendToDevice(
      eventType,
      [{ userId: bot, deviceId: "*" }],
      content,
    );
    return;
  }
  const crypto = room.client.getCrypto();
  if (crypto === undefined) throw new Error("Encryption isn't available");
  await trackUser(crypto, bot);
  const devices = await crypto.getUserDeviceInfo([bot], true);
  const targets = [...(devices.get(bot)?.keys() ?? [])].map((deviceId) => ({
    userId: bot,
    deviceId,
  }));
  if (targets.length === 0) throw new Error("The transcriber has no devices");
  await room.client.queueToDevice(
    await crypto.encryptToDeviceMessages(eventType, targets, content),
  );
}
