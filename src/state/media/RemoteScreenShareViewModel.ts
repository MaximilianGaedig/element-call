/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { Track, type RemoteParticipant } from "livekit-client";

import { type Behavior, computed } from "../Behavior";
import {
  type BaseScreenShareInputs,
  type BaseScreenShareViewModel,
  createBaseScreenShare,
} from "./ScreenShareViewModel";
import { type Scope } from "../Scope";
import { createVolumeControls, type VolumeControls } from "../VolumeControls";
import { trackReference$ } from "../trackReference";
import {
  type StreamModeration,
  type StreamModeratorControls,
} from "../FloorControl";

export interface RemoteScreenShareViewModel
  extends BaseScreenShareViewModel, VolumeControls {
  local: false;
  /**
   * Whether this screen share's video should be displayed.
   */
  videoEnabled$: Behavior<boolean>;
  /**
   * Whether this screen share should be considered to have an audio track.
   */
  audioEnabled$: Behavior<boolean>;
  /** What floor control asks of this screen share. */
  moderation$: Behavior<StreamModeration>;
  /** Controls for moderating it, if the local user may. */
  moderator$: Behavior<StreamModeratorControls | null>;
}

export interface RemoteScreenShareInputs extends BaseScreenShareInputs {
  participant$: Behavior<RemoteParticipant | null>;
  pretendToBeDisconnected$: Behavior<boolean>;
  moderation$: Behavior<StreamModeration>;
  moderator$: Behavior<StreamModeratorControls | null>;
}

export function createRemoteScreenShare(
  scope: Scope,
  {
    pretendToBeDisconnected$,
    moderation$,
    moderator$,
    ...inputs
  }: RemoteScreenShareInputs,
): RemoteScreenShareViewModel {
  const audio$ = trackReference$(
    scope,
    inputs.participant$,
    Track.Source.ScreenShareAudio,
  );
  return {
    ...createBaseScreenShare(scope, inputs),
    ...createVolumeControls(scope, {
      pretendToBeDisconnected$,
      sink$: computed(() => {
        const participant = inputs.participant$.value;
        // As for a microphone: silent if a moderator muted it, scaled by
        // any volume they set (no more than doubled), and capped at 1x
        // since it plays through an <audio> element
        const { audioMuted, volume: moderatedVolume } = moderation$.value;
        const scale = Math.min(2, moderatedVolume ?? 1);
        return (volume: number) =>
          participant?.setVolume(
            audioMuted ? 0 : Math.min(1, volume * scale),
            Track.Source.ScreenShareAudio,
          );
      }),
    }),
    local: false,
    // A share a moderator has muted the video of isn't shown
    videoEnabled$: computed(
      () => !pretendToBeDisconnected$.value && !moderation$.value.videoMuted,
    ),
    audioEnabled$: computed(() => audio$.value !== undefined),
    moderation$,
    moderator$,
  };
}
