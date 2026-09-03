/*
Copyright 2025 Element Creations Ltd.
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  MembershipManagerEvent,
  Status,
  type MatrixRTCSession,
} from "matrix-js-sdk/lib/matrixrtc";
import { ClientEvent, type MatrixClient, SyncState } from "matrix-js-sdk";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { Config } from "../../../config/Config";
import { type ObservableScope } from "../../ObservableScope";
import {
  type Behavior,
  computed,
  type Emitter,
  fromEvents,
  state,
} from "../../Behavior";

export type HomeserverDisconnectReason = "sync" | "membership" | "probablyLeft";

export interface HomeserverConnected {
  /**
   * `[true, null]` when the homeserver connection is healthy, or
   * `[false, reason]` when one of the three sub-conditions fails.
   */
  combined$: Behavior<[boolean, HomeserverDisconnectReason | null]>;
  rtsSession$: Behavior<Status>;
}

/**
 * Behavior representing whether we consider ourselves connected to the Matrix homeserver
 * for the purposes of a MatrixRTC session.
 *
 * `combined$` is `[true, null]` when all conditions are satisfied, or the first failing
 * reason (priority: syncing > membershipConnected > certainlyConnected):
 * 1. Sync loop is not in SyncState.Syncing (after grace period) → "sync"
 * 2. membershipStatus !== Status.Connected → "membership"
 * 3. probablyLeft === true → "probablyLeft"
 *
 * @param scope - The observable scope for lifecycle management.
 * @param client - The Matrix client to monitor sync state.
 * @param matrixRTCSession - The RTC session to monitor membership.
 * @param gracePeriodMs - Grace period in milliseconds to wait before reporting sync disconnect.
 *                        If not provided, uses the config value (default 10000ms).
 */
export function createHomeserverConnected$(
  scope: ObservableScope,
  client: Emitter & Pick<MatrixClient, "getSyncState">,
  matrixRTCSession: Emitter &
    Pick<MatrixRTCSession, "membershipStatus" | "probablyLeft">,
  gracePeriodMs?: number,
): HomeserverConnected {
  const logger = rootLogger.getChild("[HomeserverConnected]");
  // Get grace period from parameter or config (default 10000ms)
  const graceMs = gracePeriodMs ?? Config.get().sync_disconnect_grace_period_ms;

  const syncState$ = fromEvents(scope, client, [ClientEvent.Sync], (c) =>
    c.getSyncState(),
  );
  // A sync outage only counts once it has lasted for the grace period
  const syncing$ = state(true);
  scope.effect(() => {
    const isSyncing = syncState$.value === SyncState.Syncing;
    if (isSyncing || graceMs <= 0) {
      syncing$.value = isSyncing;
      return;
    }
    const timer = setTimeout(() => {
      syncing$.value = false;
    }, graceMs);
    return (): void => clearTimeout(timer);
  });

  const rtsSession$ = fromEvents(
    scope,
    matrixRTCSession,
    [MembershipManagerEvent.StatusChanged],
    (session) => session.membershipStatus ?? Status.Unknown,
  );

  // probablyLeft is computed by a local timer that mimics the server delayed event.
  // If we locally predict our server event timed out, we consider ourselves as probablyLeft
  // even though we might not yet have received the delayed event leave.
  //
  // If that is not the case we certainly still have a valid membership on the matrix network
  // independent of whether sync currently works.
  const certainlyConnected$ = fromEvents(
    scope,
    matrixRTCSession,
    [MembershipManagerEvent.ProbablyLeft],
    (session) => session.probablyLeft !== true,
  );

  const combined$ = computed(
    (): [boolean, HomeserverDisconnectReason | null] => {
      if (!syncing$.value) return [false, "sync"];
      if (rtsSession$.value !== Status.Connected) return [false, "membership"];
      if (!certainlyConnected$.value) return [false, "probablyLeft"];
      return [true, null];
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  scope.effect(() => {
    const [connected, reason] = combined$.value;
    logger.info(
      `Homeserver connected update: ${connected ? "connected" : reason}`,
    );
  });

  return { combined$, rtsSession$ };
}
