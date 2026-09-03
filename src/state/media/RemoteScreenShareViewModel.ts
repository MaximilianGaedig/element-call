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
}

export interface RemoteScreenShareInputs extends BaseScreenShareInputs {
  participant$: Behavior<RemoteParticipant | null>;
  pretendToBeDisconnected$: Behavior<boolean>;
}

export function createRemoteScreenShare(
  scope: Scope,
  { pretendToBeDisconnected$, ...inputs }: RemoteScreenShareInputs,
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
      sink$: computed(
        () => (volume: number) =>
          inputs.participant$.value?.setVolume(
            volume,
            Track.Source.ScreenShareAudio,
          ),
      ),
    }),
    local: false,
    videoEnabled$: computed(() => !pretendToBeDisconnected$.value),
    audioEnabled$: computed(() => audio$.value !== undefined),
  };
}
