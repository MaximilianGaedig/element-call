/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CallMembership,
  type LivekitTransportConfig,
  type MatrixRTCSession,
  MatrixRTCSessionEvent,
  isLivekitTransportConfig,
} from "matrix-js-sdk/lib/matrixrtc";
import { fromEvent } from "rxjs";

import { type ObservableScope } from "./ObservableScope";
import { type Behavior, computed } from "./Behavior";

export const membershipsAndTransports$ = (
  memberships$: Behavior<CallMembership[]>,
): {
  membershipsWithTransport$: Behavior<
    { membership: CallMembership; transport?: LivekitTransportConfig }[]
  >;
  transports$: Behavior<LivekitTransportConfig[]>;
} => {
  /**
   * Lists the transports used by ourselves, plus all other MatrixRTC session
   * members.
   */
  const membershipsWithTransport$ = computed(() => {
    const memberships = memberships$.value;
    return memberships.map((membership) => {
      const oldestMembership = memberships[0] ?? membership;
      const transport = membership.getTransport(oldestMembership);
      return {
        membership,
        transport: isLivekitTransportConfig(transport) ? transport : undefined,
      };
    });
  });

  const transports$ = computed(() =>
    membershipsWithTransport$.value.flatMap(({ transport: t }) =>
      t ? [t] : [],
    ),
  );

  return {
    membershipsWithTransport$,
    transports$,
  };
};

export const createMemberships$ = (
  scope: ObservableScope,
  matrixRTCSession: MatrixRTCSession,
): Behavior<CallMembership[]> => {
  return scope.behavior(
    fromEvent(
      matrixRTCSession,
      MatrixRTCSessionEvent.MembershipsChanged,
      (_, memberships: CallMembership[]) => memberships,
    ),
    matrixRTCSession.memberships,
  );
};

/**
 * Whether the session has grown large enough that MatrixRTC has stopped rotating the media
 * encryption key. While this is true the key in use is still shared with new joiners, but no new
 * key is generated when someone joins or leaves.
 */
export const createKeyRotationSuppressed$ = (
  scope: ObservableScope,
  matrixRTCSession: MatrixRTCSession,
): Behavior<boolean> => {
  return scope.behavior(
    fromEvent(
      matrixRTCSession,
      MatrixRTCSessionEvent.KeyRotationSuppressedChanged,
      (suppressed: boolean) => suppressed,
    ),
    matrixRTCSession.isKeyRotationSuppressed,
  );
};
