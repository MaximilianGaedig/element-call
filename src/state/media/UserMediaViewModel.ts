/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { ParticipantEvent, Track } from "livekit-client";

import { type ReactionOption } from "../../reactions";
import { type Behavior, computed, fromEvents, state } from "../Behavior";
import { type LocalUserMediaViewModel } from "./LocalUserMediaViewModel";
import {
  createMemberMedia,
  type MemberMediaInputs,
  type BaseMemberMediaViewModel,
} from "./MemberMediaViewModel";
import { type RemoteUserMediaViewModel } from "./RemoteUserMediaViewModel";
import { type ObservableScope } from "../ObservableScope";
import { showConnectionStats } from "../../settings/settings";
import { rtpStreamStats$, type RtpStreamStats } from "./rtpStreamStats";
import { MEDIA_EVENTS } from "../trackReference";

/**
 * A participant's user media (i.e. their microphone and camera feed).
 */
export type UserMediaViewModel =
  | LocalUserMediaViewModel
  | RemoteUserMediaViewModel;

export interface BaseUserMediaViewModel extends BaseMemberMediaViewModel {
  type: "user";
  speaking$: Behavior<boolean>;
  audioEnabled$: Behavior<boolean>;
  videoEnabled$: Behavior<boolean>;
  videoOrientation$: Behavior<"landscape" | "portrait">;
  /**
   * The expected identity of the LiveKit participant. Exposed for debugging.
   */
  rtcBackendIdentity: string;
  handRaised$: Behavior<Date | null>;
  reaction$: Behavior<ReactionOption | null>;
  audioStreamStats$: Behavior<RtpStreamStats | undefined>;
  videoStreamStats$: Behavior<RtpStreamStats | undefined>;
  /**
   * Set the aspect ratio of the video track to determine the orientation.
   */
  setVideoAspectRatio: (ratio: number) => void;
}

export interface BaseUserMediaInputs extends Omit<
  MemberMediaInputs,
  "audioSource" | "videoSource"
> {
  rtcBackendIdentity: string;
  handRaised$: Behavior<Date | null>;
  reaction$: Behavior<ReactionOption | null>;
  statsType: "inbound-rtp" | "outbound-rtp";
}

export function createBaseUserMedia(
  scope: ObservableScope,
  {
    rtcBackendIdentity,
    handRaised$,
    reaction$,
    statsType,
    ...inputs
  }: BaseUserMediaInputs,
): BaseUserMediaViewModel {
  const { participant$ } = inputs;
  const videoAspectRatio$ = state(NaN);
  const trackEnabled$ = (source: Track.Source): Behavior<boolean> =>
    fromEvents(
      scope,
      participant$,
      MEDIA_EVENTS,
      (p) => p?.getTrackPublication(source)?.isMuted === false,
    );
  const streamStats$ = (
    source: Track.Source,
  ): Behavior<RtpStreamStats | undefined> =>
    rtpStreamStats$(
      scope,
      participant$,
      source,
      statsType,
      showConnectionStats.value$,
    );

  return {
    ...createMemberMedia(scope, {
      ...inputs,
      audioSource: Track.Source.Microphone,
      videoSource: Track.Source.Camera,
    }),
    type: "user",
    speaking$: fromEvents(
      scope,
      participant$,
      [ParticipantEvent.IsSpeakingChanged],
      (p) => p?.isSpeaking ?? false,
    ),
    audioEnabled$: trackEnabled$(Track.Source.Microphone),
    videoEnabled$: trackEnabled$(Track.Source.Camera),
    videoOrientation$: computed(() =>
      videoAspectRatio$.value > 1 ? "landscape" : "portrait",
    ),
    rtcBackendIdentity,
    handRaised$,
    reaction$,
    audioStreamStats$: streamStats$(Track.Source.Microphone),
    videoStreamStats$: streamStats$(Track.Source.Camera),
    setVideoAspectRatio: (ratio) => (videoAspectRatio$.value = ratio),
  };
}
