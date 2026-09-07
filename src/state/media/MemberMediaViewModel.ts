/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type AudioSource,
  type TrackReference,
  type VideoSource,
} from "@livekit/components-core";
import { type LocalParticipant, type RemoteParticipant } from "livekit-client";
import { type Room as LivekitRoom } from "livekit-client";

import { type Behavior, computed, state } from "../Behavior";
import { type BaseMediaViewModel, createBaseMedia } from "./MediaViewModel";
import { type EncryptionSystem } from "../../e2ee/sharedKeyManagement";
import { type Scope } from "../Scope";
import { trackReference$ } from "../trackReference";
import { E2eeType } from "../../e2ee/e2eeType";
import { type UserMediaViewModel } from "./UserMediaViewModel";
import { type ScreenShareViewModel } from "./ScreenShareViewModel";

/**
 * Properties common to all MemberMediaViewModels.
 */
export interface BaseMemberMediaViewModel extends BaseMediaViewModel {
  /**
   * The LiveKit video track for this media.
   */
  video$: Behavior<TrackReference | undefined>;
  /** The aspect ratio of the video track, NaN until it's known. */
  videoAspectRatio$: Behavior<number>;
  /**
   * Set the aspect ratio of the video track to determine the orientation.
   */
  setVideoAspectRatio: (ratio: number) => void;
  /**
   * The URL of the LiveKit focus on which this member should be publishing.
   * Exposed for debugging.
   */
  focusUrl$: Behavior<string | undefined>;
  /**
   * Whether there should be a warning that this media is unencrypted.
   */
  unencryptedWarning$: Behavior<boolean>;
}

export interface MemberMediaInputs extends BaseMediaViewModel {
  participant$: Behavior<LocalParticipant | RemoteParticipant | null>;
  livekitRoom$: Behavior<LivekitRoom | undefined>;
  audioSource: AudioSource;
  videoSource: VideoSource;
  focusUrl$: Behavior<string | undefined>;
  encryptionSystem: EncryptionSystem;
}

export function createMemberMedia(
  scope: Scope,
  {
    participant$,
    audioSource,
    videoSource,
    focusUrl$,
    encryptionSystem,
    ...inputs
  }: MemberMediaInputs,
): BaseMemberMediaViewModel {
  const audio$ = trackReference$(scope, participant$, audioSource);
  const video$ = trackReference$(scope, participant$, videoSource);
  const videoAspectRatio$ = state(NaN);

  return {
    ...createBaseMedia(inputs),
    video$,
    videoAspectRatio$,
    setVideoAspectRatio: (ratio) => (videoAspectRatio$.value = ratio),
    focusUrl$,
    unencryptedWarning$: computed(
      () =>
        encryptionSystem.kind !== E2eeType.NONE &&
        (audio$.value?.publication.isEncrypted === false ||
          video$.value?.publication.isEncrypted === false),
    ),
  };
}

/**
 * Media belonging to an active member of the call.
 */
export type MemberMediaViewModel = UserMediaViewModel | ScreenShareViewModel;
