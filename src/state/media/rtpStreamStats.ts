/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  LocalTrack,
  type Participant,
  RemoteTrack,
  type Track,
} from "livekit-client";

import { type Behavior, state } from "../Behavior";
import { type Scope } from "../Scope";
import { trackReference$ } from "../trackReference";

export type RtpStreamStats =
  | RTCInboundRtpStreamStats
  | RTCOutboundRtpStreamStats;

/**
 * The RTP stream stats of a participant's track, refreshed every second while
 * enabled.
 */
export function rtpStreamStats$(
  scope: Scope,
  participant$: Behavior<Participant | null>,
  source: Track.Source,
  type: "inbound-rtp" | "outbound-rtp",
  enabled$: Behavior<boolean>,
): Behavior<RtpStreamStats | undefined> {
  const trackReference = trackReference$(scope, participant$, source);
  const stats$ = state<RtpStreamStats | undefined>(undefined);
  scope.effect(() => {
    const track = enabled$.value
      ? trackReference.value?.publication.track
      : undefined;
    if (!(track instanceof RemoteTrack || track instanceof LocalTrack)) {
      stats$.value = undefined;
      return;
    }
    let stopped = false;
    const refresh = async (): Promise<void> => {
      const report = await track.getRTCStatsReport();
      if (stopped) return;
      stats$.value = report
        ? [...report.values()].find((v) => v.type === type)
        : undefined;
    };
    void refresh();
    // ponytail: one timer per track; share a single tick if this ever shows up in profiles
    const interval = setInterval(() => void refresh(), 1000);
    return (): void => {
      stopped = true;
      clearInterval(interval);
    };
  });
  return stats$;
}
