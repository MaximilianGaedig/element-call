/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test } from "vitest";
import {
  EventType,
  type IRoomTimelineData,
  MatrixEvent,
  type Room,
  RoomEvent,
} from "matrix-js-sdk";
import { type RTCCallIntent } from "matrix-js-sdk/lib/matrixrtc";

import { mockMatrixRoom, withTestScheduler } from "../../utils/test";
import {
  alice,
  aliceRtcMember,
  local,
  localRtcMember,
} from "../../utils/test-fixtures";
import {
  type CallNotificationWrapper,
  createCallNotificationLifecycle$,
  type RingAttempt,
} from "./CallNotificationLifecycle";
import { type Behavior, computed, constant } from "../Behavior";

function mockRingEvent(
  eventId: string,
  lifetimeMs: number | undefined,
  sender = local.userId,
): CallNotificationWrapper {
  return {
    event_id: eventId,
    ...(lifetimeMs === undefined ? {} : { lifetime: lifetimeMs }),
    notification_type: "ring",
    sender,
  } as unknown as CallNotificationWrapper;
}

function mockDeclineEvent(
  relatesTo: string,
  sender = alice.userId,
): [MatrixEvent, Room, undefined, false, IRoomTimelineData] {
  return [
    new MatrixEvent({
      type: EventType.RTCDecline,
      sender,
      content: {
        "m.relates_to": {
          rel_type: "m.reference",
          event_id: relatesTo,
        },
      },
    }),
    {} as Room,
    undefined,
    false,
    {} as IRoomTimelineData,
  ];
}

const defaultProps = {
  memberships$: constant([]),
  matrixRoomMembers$: constant(new Map([[alice.userId, alice]])),
  options: {
    waitForCallPickup: true,
    autoLeaveWhenOthersLeft: false,
  },
  localUser: localRtcMember,
};

/**
 * Summarizes the current ring attempt as who is being rung, or how it ended.
 */
function summarizeRingAttempt$(
  ringAttempt$: Behavior<RingAttempt | null>,
): Behavior<
  | { intent: RTCCallIntent; recipient: string }
  | { outcome: "accept" | "decline" | "timeout" }
  | null
> {
  return computed(() => {
    const attempt = ringAttempt$.value;
    if (attempt === null) return null;
    const outcome = attempt.outcome$.value;
    return outcome === "ringing"
      ? { intent: attempt.intent, recipient: attempt.recipient }
      : { outcome };
  });
}

test("no ring attempt when waitForCallPickup=false", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom: mockMatrixRoom({}),
      sentCallNotification$: behavior("-a", {
        "-": null,
        a: mockRingEvent("$notif1", 30),
      }),
      options: { ...defaultProps.options, waitForCallPickup: false },
    });

    expectObservable(ringAttempt$).toBe("n", { n: null });
  });
});

test("no ring attempt when notification type is not ring", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom: mockMatrixRoom({}),
      sentCallNotification$: behavior("na", {
        n: null,
        a: {
          ...mockRingEvent("$notif1", 30),
          notification_type: "notification",
        },
      }),
    });

    expectObservable(ringAttempt$).toBe("n", { n: null });
  });
});

test("no ring attempt if lifetime is missing", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom: mockMatrixRoom({}),
      sentCallNotification$: behavior("na", {
        n: null,
        a: mockRingEvent("$notif1", undefined),
      }),
    });

    expectObservable(ringAttempt$).toBe("n", { n: null });
  });
});

test("ring attempt times out after nobody joins", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$, autoLeaveReason$ } = createCallNotificationLifecycle$(
      {
        scope,
        ...defaultProps,
        // No one ever joins (only local user)
        memberships$: constant([]),
        matrixRoom: mockMatrixRoom({}),
        sentCallNotification$: behavior("na", {
          n: null,
          a: mockRingEvent("$notif1", 30),
        }),
      },
    );

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("na 29ms A", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "timeout" },
    });
    expectObservable(autoLeaveReason$).toBe("n 30ms t", {
      n: null,
      t: "timeout",
    });
  });
});

test("ring attempt is accepted once recipient joins", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$, autoLeaveReason$ } = createCallNotificationLifecycle$(
      {
        scope,
        ...defaultProps,
        memberships$: behavior("a-b", { a: [], b: [aliceRtcMember] }),
        matrixRoom: mockMatrixRoom({}),
        sentCallNotification$: behavior("na", {
          n: null,
          a: mockRingEvent("$notif1", 30),
        }),
      },
    );

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("naA", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "accept" },
    });
    expectObservable(autoLeaveReason$).toBe("n", { n: null });
  });
});

test("ring attempt is immediately accepted if recipient is already joined", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      memberships$: constant([aliceRtcMember]),
      matrixRoom: mockMatrixRoom({}),
      sentCallNotification$: behavior("na", {
        n: null,
        a: mockRingEvent("$notif1", 30),
      }),
    });

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("nA", {
      n: null,
      A: { outcome: "accept" },
    });
  });
});

test("ring attempt can be declined", () => {
  withTestScheduler(({ scope, expectObservable, behavior, schedule }) => {
    const matrixRoom = mockMatrixRoom({});
    const { ringAttempt$, autoLeaveReason$ } = createCallNotificationLifecycle$(
      {
        scope,
        ...defaultProps,
        matrixRoom,
        sentCallNotification$: behavior("na", {
          n: null,
          a: mockRingEvent("$notif1", 30),
        }),
      },
    );
    schedule("--d", {
      d: () =>
        matrixRoom.emit(RoomEvent.Timeline, ...mockDeclineEvent("$notif1")),
    });

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("naA", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "decline" },
    });
    expectObservable(autoLeaveReason$).toBe("n-d", { n: null, d: "decline" });
  });
});

test("ring attempt times out if recipient declines too late", () => {
  withTestScheduler(({ scope, expectObservable, behavior, schedule }) => {
    const matrixRoom = mockMatrixRoom({});
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom,
      sentCallNotification$: behavior("na", {
        n: null,
        a: mockRingEvent("$notif1", 30),
      }),
    });
    schedule("100ms d", {
      d: () =>
        matrixRoom.emit(RoomEvent.Timeline, ...mockDeclineEvent("$notif1")),
    });

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("na 29ms A", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "timeout" },
    });
  });
});

test("decline event relating to wrong event is ignored (times out)", () => {
  withTestScheduler(({ scope, expectObservable, behavior, schedule }) => {
    const matrixRoom = mockMatrixRoom({});
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom,
      sentCallNotification$: behavior("na", {
        n: null,
        a: mockRingEvent("$notif1", 30),
      }),
    });
    schedule("--d", {
      d: () =>
        matrixRoom.emit(
          RoomEvent.Timeline,
          ...mockDeclineEvent("$other"), // <---- WRONG
        ),
    });

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("na 29ms A", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "timeout" },
    });
  });
});

test("decline event from wrong sender is ignored (times out)", () => {
  withTestScheduler(({ scope, expectObservable, behavior, schedule }) => {
    const matrixRoom = mockMatrixRoom({});
    const { ringAttempt$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      matrixRoom,
      sentCallNotification$: behavior("na", {
        n: null,
        a: mockRingEvent("$notif1", 30),
      }),
    });
    schedule("--d", {
      d: () =>
        matrixRoom.emit(
          RoomEvent.Timeline,
          ...mockDeclineEvent("$notif1", local.userId), // <---- WRONG sender
        ),
    });

    expectObservable(summarizeRingAttempt$(ringAttempt$)).toBe("na 29ms A", {
      n: null,
      a: { intent: "audio", recipient: alice.userId },
      A: { outcome: "timeout" },
    });
  });
});

test("everyone else leaving triggers an auto-leave when enabled", () => {
  withTestScheduler(({ scope, expectObservable, behavior }) => {
    const { autoLeaveReason$ } = createCallNotificationLifecycle$({
      scope,
      ...defaultProps,
      memberships$: behavior("ab-c", {
        a: [localRtcMember],
        b: [localRtcMember, aliceRtcMember],
        c: [localRtcMember],
      }),
      matrixRoom: mockMatrixRoom({}),
      sentCallNotification$: constant(null),
      options: { waitForCallPickup: false, autoLeaveWhenOthersLeft: true },
    });

    expectObservable(autoLeaveReason$).toBe("n--l", {
      n: null,
      l: "allOthersLeft",
    });
  });
});
