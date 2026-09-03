/*
Copyright 2025-2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type LocalParticipant, type RemoteParticipant } from "livekit-client";

import { type Scope } from "../Scope.ts";
import { type Behavior, computed, fromEvents } from "../Behavior.ts";
import type { MediaDevices } from "../MediaDevices.ts";
import { speaker$ } from "./speaker.ts";
import { keyedItems } from "../keyedItems.ts";
import { PUBLICATION_EVENTS } from "../trackReference.ts";
import { type TaggedParticipant } from "../CallViewModel/remoteMembers/MatrixLivekitMembers.ts";
import { type UserMediaViewModel } from "./UserMediaViewModel.ts";
import { type ScreenShareViewModel } from "./ScreenShareViewModel.ts";
import {
  createLocalUserMedia,
  type LocalUserMediaInputs,
} from "./LocalUserMediaViewModel.ts";
import {
  createRemoteUserMedia,
  type RemoteUserMediaInputs,
} from "./RemoteUserMediaViewModel.ts";
import { createLocalScreenShare } from "./LocalScreenShareViewModel.ts";
import { createRemoteScreenShare } from "./RemoteScreenShareViewModel.ts";

/**
 * Sorting bins defining the order in which media tiles appear in the layout.
 */
enum SortingBin {
  /**
   * Yourself, when the "always show self" option is on.
   */
  SelfAlwaysShown,
  /**
   * Participants that are sharing their screen.
   */
  Presenters,
  /**
   * Participants that have been speaking recently.
   */
  Speakers,
  /**
   * Participants that have their hand raised.
   */
  HandRaised,
  /**
   * Participants with video.
   */
  Video,
  /**
   * Participants not sharing any video.
   */
  NoVideo,
  /**
   * Yourself, when the "always show self" option is off.
   */
  SelfNotAlwaysShown,
}

/**
 * A user media item to be presented in a tile. This is a thin wrapper around
 * UserMediaViewModel which additionally carries data relevant to the tile
 * layout algorithms (data which the MediaView component should be ignorant of).
 */
export type WrappedUserMediaViewModel = UserMediaViewModel & {
  /**
   * All screen share media associated with this user media.
   */
  screenShares$: Behavior<ScreenShareViewModel[]>;
  /**
   * Which sorting bin the media item should be placed in.
   */
  bin$: Behavior<SortingBin>;
};

interface WrappedUserMediaInputs extends Omit<
  LocalUserMediaInputs & RemoteUserMediaInputs,
  "participant$"
> {
  participant: TaggedParticipant;
  mediaDevices: MediaDevices;
  pretendToBeDisconnected$: Behavior<boolean>;
}

export function createWrappedUserMedia(
  scope: Scope,
  {
    participant,
    mediaDevices,
    pretendToBeDisconnected$,
    ...inputs
  }: WrappedUserMediaInputs,
): WrappedUserMediaViewModel {
  const userMedia =
    participant.type === "local"
      ? createLocalUserMedia(scope, {
          participant$: participant.value$,
          mediaDevices,
          ...inputs,
        })
      : createRemoteUserMedia(scope, {
          participant$: participant.value$,
          pretendToBeDisconnected$,
          ...inputs,
        });

  // TypeScript needs this widening of the type to happen in a separate statement
  const participant$: Behavior<LocalParticipant | RemoteParticipant | null> =
    participant.value$;

  const screenShareEnabled$ = fromEvents(
    scope,
    participant$,
    PUBLICATION_EVENTS,
    (p) => p?.isScreenShareEnabled ?? false,
  );
  // Technically more than one screen share might be possible... our
  // MediaViewModels don't support it though since they look for a unique
  // track for the given source.
  const screenShares$ = keyedItems(
    scope,
    `${inputs.id} screenShares$`,
    screenShareEnabled$,
    (enabled) =>
      enabled ? [{ keys: ["screen-share"] as const, data: undefined }] : [],
    (scope, _data$, key) => {
      const id = `${inputs.id}:${key}`;
      return participant.type === "local"
        ? createLocalScreenShare(scope, {
            ...inputs,
            id,
            participant$: participant.value$,
          })
        : createRemoteScreenShare(scope, {
            ...inputs,
            id,
            participant$: participant.value$,
            pretendToBeDisconnected$,
          });
    },
  );

  const isSpeaker$ = speaker$(scope, userMedia.speaking$);

  return {
    ...userMedia,
    screenShares$,
    bin$: computed(() => {
      if (userMedia.local)
        return userMedia.alwaysShow$.value
          ? SortingBin.SelfAlwaysShown
          : SortingBin.SelfNotAlwaysShown;
      else if (screenShares$.value.length > 0) return SortingBin.Presenters;
      else if (isSpeaker$.value) return SortingBin.Speakers;
      else if (userMedia.handRaised$.value) return SortingBin.HandRaised;
      else if (userMedia.videoEnabled$.value) return SortingBin.Video;
      else return SortingBin.NoVideo;
    }),
  };
}
