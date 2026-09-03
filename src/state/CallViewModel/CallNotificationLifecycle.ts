/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CallMembership,
  type IRTCNotificationContent,
  type MatrixRTCSession,
  MatrixRTCSessionEvent,
  type RTCCallIntent,
} from "matrix-js-sdk/lib/matrixrtc";
import { EventType, type MatrixEvent, RoomEvent } from "matrix-js-sdk";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";
import { untracked } from "@preact/signals-core";

import { type Behavior, type Emitter, state } from "../Behavior";
import { ObservableScope } from "../ObservableScope";
import { type RoomMemberMap } from "./remoteMembers/MatrixMemberMetadata";

export type AutoLeaveReason = "allOthersLeft" | "timeout" | "decline";

export type RingOutcome = "accept" | "decline" | "timeout";

export interface RingAttempt {
  intent: RTCCallIntent;
  /**
   * The user ID of the recipient being rung.
   */
  recipient: string;
  /**
   * How the ringing attempt is going, and eventually how it ended.
   */
  // TODO: Include a callback for attempting ringing again in case of a timeout
  outcome$: Behavior<"ringing" | RingOutcome>;
}

export type CallNotificationWrapper = {
  event_id: string;
} & IRTCNotificationContent;

/**
 * The most recent call notification that we sent, if any.
 */
export function createSentCallNotification$(
  scope: ObservableScope,
  matrixRTCSession: MatrixRTCSession,
): Behavior<CallNotificationWrapper | null> {
  const sent$ = state<CallNotificationWrapper | null>(null);
  scope.effect(() => {
    const onSent = (notification: CallNotificationWrapper): void => {
      sent$.value = notification;
    };
    matrixRTCSession.on(MatrixRTCSessionEvent.DidSendCallNotification, onSent);
    return (): void => {
      matrixRTCSession.off(
        MatrixRTCSessionEvent.DidSendCallNotification,
        onSent,
      );
    };
  });
  return sent$;
}

export interface Props {
  scope: ObservableScope;
  memberships$: Behavior<CallMembership[]>;
  matrixRoomMembers$: Behavior<RoomMemberMap>;
  sentCallNotification$: Behavior<CallNotificationWrapper | null>;
  /** The Matrix room, whose timeline is watched for decline events. */
  matrixRoom: Emitter;
  options: { waitForCallPickup?: boolean; autoLeaveWhenOthersLeft?: boolean };
  localUser: { deviceId: string; userId: string };
}

export function createCallNotificationLifecycle$({
  scope,
  memberships$,
  matrixRoomMembers$,
  sentCallNotification$,
  matrixRoom,
  options,
  localUser,
}: Props): {
  /**
   * The current attempt to ring the remote participant's devices, if any.
   */
  ringAttempt$: Behavior<RingAttempt | null>;
  /**
   * Set once the call should be automatically left:
   *  - if options.autoLeaveWhenOthersLeft is set to true, when all others left.
   *  - if options.waitForCallPickup is set to true, if no one picked up the ring or if the ring got declined.
   *  - if options.autoLeaveWhenOthersLeft && options.waitForCallPickup is false it will never be set.
   */
  autoLeaveReason$: Behavior<AutoLeaveReason | null>;
} {
  const logger = rootLogger.getChild("[CallNotificationLifecycle]");
  const ringAttempt$ = state<RingAttempt | null>(null);
  const autoLeaveReason$ = state<AutoLeaveReason | null>(null);
  const autoLeave = (reason: AutoLeaveReason): void => {
    if (autoLeaveReason$.peek() === null) autoLeaveReason$.value = reason;
  };

  if (options.waitForCallPickup)
    scope.effect(() => {
      const notification = sentCallNotification$.value;
      // only care about new events (legacy do not have decline pattern)
      if (
        notification?.notification_type !== "ring" ||
        !(notification.lifetime > 0)
      )
        return;
      // We assume that there is only one other user in the room when ringing
      // TODO: Respect io.element.functional_members
      const recipient = untracked(() =>
        [...matrixRoomMembers$.value.keys()].find(
          (userId) => userId !== localUser.userId,
        ),
      );
      if (recipient === undefined) {
        logger.warn("No recipient for notification event; not ringing.");
        return;
      }

      const outcome$ = state<"ringing" | RingOutcome>("ringing");
      const attempt = new ObservableScope();
      const settle = (outcome: RingOutcome): void => {
        outcome$.value = outcome;
        attempt.end();
      };
      // Ringing times out after lifetime ms have passed
      const timeout = setTimeout(
        () => settle("timeout"),
        notification.lifetime,
      );
      attempt.onEnd(() => clearTimeout(timeout));
      // Call is accepted when the recipient joins
      attempt.effect(() => {
        if (memberships$.value.some((m) => m.userId === recipient))
          settle("accept");
      });
      // Call is declined when we receive a decline event
      const onTimeline = (event: MatrixEvent): void => {
        if (
          event.getType() === EventType.RTCDecline &&
          event.getRelation()?.rel_type === "m.reference" &&
          event.getRelation()?.event_id === notification.event_id &&
          event.getSender() === recipient
        )
          settle("decline");
      };
      matrixRoom.on(RoomEvent.Timeline, onTimeline);
      attempt.onEnd(() => matrixRoom.off(RoomEvent.Timeline, onTimeline));

      ringAttempt$.value = {
        intent: notification["m.call.intent"] ?? "audio",
        recipient,
        outcome$,
      };
      return (): void => attempt.end();
    });

  scope.effect(() => {
    const outcome = ringAttempt$.value?.outcome$.value;
    if (outcome === "timeout" || outcome === "decline") autoLeave(outcome);
  });

  if (options.autoLeaveWhenOthersLeft === true) {
    let previous = memberships$.value;
    scope.effect(() => {
      const current = memberships$.value;
      if (
        current.every((m) => m.userId === localUser.userId) &&
        previous.some((m) => m.userId !== localUser.userId)
      )
        autoLeave("allOthersLeft");
      previous = current;
    });
  }

  return { ringAttempt$, autoLeaveReason$ };
}
