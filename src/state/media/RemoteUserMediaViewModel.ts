/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type RemoteParticipant } from "livekit-client";

import { type Behavior, computed } from "../Behavior";
import { createVolumeControls, type VolumeControls } from "../VolumeControls";
import {
  type BaseUserMediaInputs,
  type BaseUserMediaViewModel,
  createBaseUserMedia,
} from "./UserMediaViewModel";
import { type Scope } from "../Scope";

export interface RemoteUserMediaViewModel
  extends BaseUserMediaViewModel, VolumeControls {
  local: false;
  /**
   * Whether we are waiting for this user's LiveKit participant to exist. This
   * could be because either we or the remote party are still connecting.
   */
  waitingForMedia$: Behavior<boolean>;
}

export interface RemoteUserMediaInputs extends Omit<
  BaseUserMediaInputs,
  "statsType"
> {
  participant$: Behavior<RemoteParticipant | null>;
  pretendToBeDisconnected$: Behavior<boolean>;
}

export function createRemoteUserMedia(
  scope: Scope,
  { pretendToBeDisconnected$, ...inputs }: RemoteUserMediaInputs,
): RemoteUserMediaViewModel {
  const baseUserMedia = createBaseUserMedia(scope, {
    ...inputs,
    statsType: "inbound-rtp",
  });

  return {
    ...baseUserMedia,
    ...createVolumeControls(scope, {
      pretendToBeDisconnected$,
      sink$: computed(() => {
        const participant = inputs.participant$.value;
        // Silence devices a moderator has muted, whatever the user's volume,
        // and scale by any volume a moderator has set
        const { audioMuted, volume: moderatedVolume } =
          inputs.moderation$.value;
        // Clients need not honour more than a doubling
        const scale = Math.min(2, moderatedVolume ?? 1);
        return (volume: number) =>
          participant?.setVolume(audioMuted ? 0 : volume * scale);
      }),
    }),
    local: false,
    speaking$: computed(() =>
      pretendToBeDisconnected$.value ? false : baseUserMedia.speaking$.value,
    ),
    // Video a moderator has muted isn't shown, whatever the device does
    videoEnabled$: computed(
      () =>
        !pretendToBeDisconnected$.value &&
        !inputs.moderation$.value.videoMuted &&
        baseUserMedia.videoEnabled$.value,
    ),
    video$: computed(() =>
      inputs.moderation$.value.videoMuted
        ? undefined
        : baseUserMedia.video$.value,
    ),
    // If livekitRoom is undefined, the user is not attempting to publish on
    // any transport and so we shouldn't expect a participant. (They might
    // be a subscribe-only bot for example.)
    waitingForMedia$: computed(
      () =>
        inputs.livekitRoom$.value !== undefined &&
        inputs.participant$.value === null,
    ),
  };
}
