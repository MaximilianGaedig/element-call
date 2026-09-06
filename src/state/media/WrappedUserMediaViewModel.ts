/*
Copyright 2025-2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type LocalParticipant, type RemoteParticipant } from "livekit-client";

import { type Scope } from "../Scope.ts";
import { type Behavior, fromEvents, state } from "../Behavior.ts";
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
   * Whether this user counts as a speaker (with the usual hysteresis).
   */
  isSpeaker$: Behavior<boolean>;
  /**
   * When this user last spoke, or joined the call.
   */
  lastActive$: Behavior<number>;
};

interface WrappedUserMediaInputs extends Omit<
  LocalUserMediaInputs & RemoteUserMediaInputs,
  "participant$"
> {
  participant: TaggedParticipant;
  mediaDevices: MediaDevices;
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * An extra copy of the tile (the developer setting), which duplicates the
   * camera feed but not the screen share.
   */
  duplicate?: boolean;
}

export function createWrappedUserMedia(
  scope: Scope,
  {
    participant,
    mediaDevices,
    pretendToBeDisconnected$,
    duplicate = false,
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
      enabled && !duplicate
        ? [{ keys: ["screen-share"] as const, data: undefined }]
        : [],
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
  const lastActive$ = state(Date.now());
  scope.effect(() => {
    if (userMedia.speaking$.value) lastActive$.value = Date.now();
  });

  return { ...userMedia, screenShares$, isSpeaker$, lastActive$ };
}
