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
import {
  type CallMembership,
  type MatrixRTCSession,
} from "matrix-js-sdk/lib/matrixrtc";
import { type EncryptedFile } from "matrix-js-sdk/lib/@types/media";
import { type CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { KnownMembership } from "matrix-js-sdk/lib/types";
import { logger } from "matrix-js-sdk/lib/logger";

import {
  type Behavior,
  computed,
  fromEvents,
  state,
  type State,
} from "./Behavior.ts";
import { type FloorControl, RecordingEventType } from "./FloorControl.ts";
import { type Scope } from "./Scope.ts";
import { E2eeType } from "../e2ee/e2eeType.ts";
import { type EncryptionSystem } from "../e2ee/sharedKeyManagement.ts";

// Recording: a state event, keyed by slot, through which users ask a
// recorder bot to record the call, and by which everyone learns that it's
// being recorded. See docs/call_recording_msc.md.

/** The recorder's answer to a request, related to it by reference. */
export const RecordingStatusEventType = "org.matrix.rtc.recording.status";
/**
 * The key under which a participant's call membership carries their
 * answers to requests that require consent, by request event ID: `true`
 * to be recorded, `false` to decline. In an `m.rtc.member` event it's in
 * the `application` object; in a legacy `m.call.member` one, top-level.
 */
export const RecordingConsentKey = "org.matrix.rtc.recording_consent";

export type RecordingMedia = "audio" | "video";
export type RecordingStreams = "composite" | "separate" | "both";

/**
 * To-device message handing the recorder the key of a call encrypted with
 * a key in its URL, which it couldn't get any other way. Sent encrypted,
 * just before the request. See docs/call_recording_shared_key.md.
 */
export const SharedKeyEventType = "io.element.call.shared_key";

/** Empty content, or no recorder, means the call isn't being recorded. */
export interface RecordingEventContent {
  recorder?: string;
  media?: RecordingMedia;
  streams?: RecordingStreams;
  /** Whether everyone in the call must consent before it's recorded. */
  requires_consent?: boolean;
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
  /** Whether the recorder has confirmed that it's recording. */
  started: boolean;
  /** Whether everyone in the call must consent before it's recorded. */
  requiresConsent: boolean;
  /** Who has consented (or not), by user ID. */
  consents: Record<string, boolean>;
  /** The users in the call who have yet to consent, when it's required. */
  awaitingConsent: string[];
}

/** The recorder said it couldn't record, or didn't answer in time. */
export class RecorderError extends Error {
  public constructor(public readonly reason?: string) {
    super(reason ?? "The recorder didn't confirm the recording");
  }
}

/** Somebody in the call declined to be recorded. */
export class ConsentDeclinedError extends Error {
  public constructor(public readonly userId: string) {
    super(`${userId} declined to be recorded`);
  }
}

/**
 * How long whoever asked waits for the recorder to confirm before giving up.
 * The recorder takes around ten seconds to start its widget and join the
 * call, so this leaves a few times that for a slow one.
 */
export const CONFIRM_TIMEOUT_MS = 30_000;

/** Where a piece of media is, and how to decrypt it if it's encrypted */
export interface MediaFile {
  /** mxc URL */
  url: string;
  /** The key, IV and hash, when the room is encrypted */
  encrypted?: EncryptedFile;
}

/** How to record, when starting. */
export interface RecordingOptions {
  /** Ask for the call's audio only, rather than a video composite. */
  audioOnly?: boolean;
  /** Record only once everyone in the call has consented. */
  requireConsent?: boolean;
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
  toggle$: Behavior<((options?: RecordingOptions) => Promise<void>) | null>;
  /** Why the last attempt to start or stop failed, until cleared. */
  error$: State<Error | null>;
  /**
   * Consents (or declines) to the recording in progress, through our call
   * membership.
   */
  consent: (agree: boolean) => Promise<void>;
}

/**
 * The answers to consent requests in a membership, by request event ID:
 * what the membership's device wants for `recording_consent`.
 */
export function membershipConsents(
  membership: Pick<CallMembership, "applicationData">,
): Record<string, boolean> {
  const consents = membership.applicationData[RecordingConsentKey];
  return typeof consents === "object" && consents !== null
    ? (consents as Record<string, boolean>)
    : {};
}

/**
 * What to put in our membership to answer a request. The lobby says that
 * joining a recorded call is consenting to it, so a client that showed
 * the lobby joins with the consent already given.
 * @param room The room, whose state may hold a request
 * @param warnedOnJoin Whether the user was told, before joining, that the
 *   call is being recorded and that joining means consenting to it.
 */
export function consentOnJoin(
  room: MatrixRoom,
  slotId: string,
  warnedOnJoin: boolean,
): Record<string, unknown> | undefined {
  if (!warnedOnJoin) return undefined;
  const event = room.currentState.getStateEvents(RecordingEventType, slotId);
  const content = event?.getContent() as RecordingEventContent | undefined;
  return content?.recorder !== undefined &&
    content.requires_consent === true &&
    event?.getSender() !== room.client.getUserId()
    ? { [RecordingConsentKey]: { [event!.getId()!]: true } }
    : undefined;
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
 * Makes the crypto stack track the recorder's devices, so that it can
 * encrypt to them. It only tracks users it shares an encrypted room with,
 * which the recorder isn't, and has no public way to add one, so this
 * reaches into the rust crypto's OlmMachine and its outgoing request loop.
 */
async function trackUser(crypto: CryptoApi, userId: string): Promise<void> {
  const { olmMachine, outgoingRequestsManager } = crypto as unknown as {
    olmMachine?: {
      userId: { constructor: new (id: string) => unknown };
      updateTrackedUsers(users: unknown[]): Promise<void>;
    };
    outgoingRequestsManager?: { doProcessOutgoingRequests(): Promise<void> };
  };
  if (olmMachine === undefined) return;
  await olmMachine.updateTrackedUsers([
    new olmMachine.userId.constructor(userId),
  ]);
  // Sends the key query that tracking the user asked for
  await outgoingRequestsManager?.doProcessOutgoingRequests();
}

/** Sends the call's shared key to every device of the recorder, encrypted. */
export async function sendSharedKey(
  room: MatrixRoom,
  recorder: string,
  key: string,
): Promise<void> {
  const crypto = room.client.getCrypto();
  if (crypto === undefined) throw new Error("Encryption isn't available");
  await trackUser(crypto, recorder);
  const devices = await crypto.getUserDeviceInfo([recorder], true);
  const targets = [...(devices.get(recorder)?.keys() ?? [])].map(
    (deviceId) => ({ userId: recorder, deviceId }),
  );
  if (targets.length === 0)
    throw new Error("The recorder has no devices to send the call's key to");
  const batch = await crypto.encryptToDeviceMessages(
    SharedKeyEventType,
    targets,
    { room_id: room.roomId, key },
  );
  await room.client.queueToDevice(batch);
}

/**
 * @param recorder The user ID of the bot to ask for recordings, if this
 *   deployment has one.
 * @param encryptionSystem How the call is encrypted: a recorder can only
 *   record a call encrypted with a shared key if it's given the key.
 * @param rtcSession The session, through whose membership we consent.
 * @param memberships$ The memberships in the call, whose data carries
 *   each participant's consent.
 * @param bots$ The users in the call who aren't people, so can't consent.
 */
export function createRecording(
  scope: Scope,
  room: MatrixRoom,
  floorControl: FloorControl,
  slotId: string,
  recorder: string | undefined,
  encryptionSystem: EncryptionSystem,
  rtcSession: Pick<MatrixRTCSession, "updateApplicationData">,
  memberships$: Behavior<Pick<CallMembership, "userId" | "applicationData">[]>,
  bots$: Behavior<Set<string>>,
): Recording {
  const userId = room.client.getUserId()!;
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
  // Requests the recorder has confirmed, by event ID
  const started$ = state<Set<string>>(new Set());
  // Our own answer, until our membership carries it
  const myConsent$ = state<{ request: string; agree: boolean } | null>(null);
  const recording$ = computed<RecordingState | null>(() => {
    const event = event$.value;
    const content = event?.getContent() as RecordingEventContent | undefined;
    if (!event || content?.recorder === undefined) return null;
    const eventId = event.getId()!;
    const by = event.getSender()!;
    const requiresConsent = content.requires_consent === true;
    // Whoever asked has consented by asking, and the bots aren't asked
    const people = memberships$.value.filter(
      (m) =>
        m.userId !== by &&
        m.userId !== content.recorder &&
        !bots$.value.has(m.userId),
    );
    const consents: Record<string, boolean> = {};
    // A user with several devices has consented if any of them has, and
    // declined if any of them has
    for (const m of people) {
      const answer = membershipConsents(m)[eventId];
      if (answer !== undefined)
        consents[m.userId] = (consents[m.userId] ?? true) && answer;
    }
    const mine = myConsent$.value;
    if (mine?.request === eventId && consents[userId] === undefined)
      consents[userId] = mine.agree;
    return {
      by,
      recorder: content.recorder,
      media: content.media ?? "video",
      streams: content.streams ?? "composite",
      eventId,
      started: started$.value.has(eventId),
      requiresConsent,
      consents,
      awaitingConsent: requiresConsent
        ? [...new Set(people.map((m) => m.userId))].filter(
            (id) => !consents[id],
          )
        : [],
    };
  });
  // The record button shows the state event, so a failed request would
  // otherwise just leave it where it was
  const error$ = state<Error | null>(null);

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
  const onStatus = (event: MatrixEvent): void => {
    const relation = event.getRelation();
    const request = relation?.event_id;
    if (relation?.rel_type !== RelationType.Reference || request === undefined)
      return;
    const { status, reason } = event.getContent();
    if (status === "started") {
      started$.value = new Set(started$.value).add(request);
    } else if (status === "failed" && request === recording$.peek()?.eventId) {
      giveUp(new RecorderError(reason));
    }
  };
  const onRecorderEvent = (event: MatrixEvent): void => {
    if (event.getType() === RecordingStatusEventType) onStatus(event);
    else onUpload(event);
  };
  const onTimeline = (
    event: MatrixEvent,
    _room: unknown,
    toStart?: boolean,
  ): void => {
    if (toStart || event.getSender() !== recorder) return;
    // In encrypted rooms the event arrives before it's decrypted
    if (event.getType() === EventType.RoomMessageEncrypted)
      event.once(MatrixEventEvent.Decrypted, onRecorderEvent);
    else onRecorderEvent(event);
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
  // Nothing is being recorded, so whoever asked clears the request (the
  // recorder should too, but it may be the one that's gone)
  const giveUp = (error: Error): void => {
    error$.value = error;
    if (recording$.peek()?.by === userId)
      send({}).catch((e) => logger.error("Failed to clear recording", e));
  };
  // A decline means it can't be recorded, so whoever asked gives up
  // without waiting for the recorder to say so
  let declined: string | null = null;
  scope.effect(() => {
    const current = recording$.value;
    if (current === null || current.eventId === declined) return;
    const decliner = Object.keys(current.consents).find(
      (id) => !current.consents[id],
    );
    if (decliner === undefined) return;
    declined = current.eventId;
    giveUp(new ConsentDeclinedError(decliner));
  });
  // The recorder can't start until everyone has consented, so the clock
  // only runs once they have
  scope.effect(() => {
    const current = recording$.value;
    if (
      current === null ||
      current.started ||
      current.by !== userId ||
      current.awaitingConsent.length > 0
    )
      return;
    const timer = setTimeout(
      () => giveUp(new RecorderError()),
      CONFIRM_TIMEOUT_MS,
    );
    return (): void => clearTimeout(timer);
  });
  const toggle = async (options?: RecordingOptions): Promise<void> => {
    try {
      if (recording$.peek() !== null) {
        await send({});
      } else {
        // toggle$ only offers this once a recorder is configured
        await inviteBot(room, recorder!);
        if (encryptionSystem.kind === E2eeType.SHARED_KEY)
          await sendSharedKey(room, recorder!, encryptionSystem.secret);
        await send({
          recorder: recorder!,
          ...(options?.audioOnly ? { media: "audio" } : {}),
          ...(options?.requireConsent ? { requires_consent: true } : {}),
        });
      }
    } catch (e) {
      logger.error("Failed to start or stop recording", e);
      error$.value = e instanceof Error ? e : new Error(String(e));
    }
  };
  // Only the current request matters, so older answers are dropped
  const consent = async (agree: boolean): Promise<void> => {
    const current = recording$.peek();
    if (current === null) return;
    await rtcSession.updateApplicationData({
      [RecordingConsentKey]: { [current.eventId]: agree },
    });
    myConsent$.value = { request: current.eventId, agree };
  };

  return {
    recording$,
    uploads$,
    error$,
    consent,
    toggle$: computed(() =>
      recorder !== undefined && floorControl.canRecord$.value ? toggle : null,
    ),
  };
}
