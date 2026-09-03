/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  facingModeFromLocalTrack,
  type LocalParticipant,
  LocalVideoTrack,
  TrackEvent,
} from "livekit-client";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior, computed, state } from "../Behavior";
import {
  type BaseUserMediaInputs,
  type BaseUserMediaViewModel,
  createBaseUserMedia,
} from "./UserMediaViewModel";
import { type ObservableScope } from "../ObservableScope";
import { alwaysShowSelf } from "../../settings/settings";
import { platform } from "../../Platform";
import { type MediaDevices } from "../MediaDevices";

export interface LocalUserMediaViewModel extends BaseUserMediaViewModel {
  local: true;
  /**
   * Whether the video should be mirrored.
   */
  mirror$: Behavior<boolean>;
  /**
   * Whether to show this tile in a highly visible location near the start of
   * the grid.
   */
  alwaysShow$: Behavior<boolean>;
  setAlwaysShow: (value: boolean) => void;
  switchCamera$: Behavior<(() => void) | null>;
}

export interface LocalUserMediaInputs extends Omit<
  BaseUserMediaInputs,
  "statsType"
> {
  participant$: Behavior<LocalParticipant | null>;
  mediaDevices: MediaDevices;
}

export function createLocalUserMedia(
  scope: ObservableScope,
  { mediaDevices, ...inputs }: LocalUserMediaInputs,
): LocalUserMediaViewModel {
  const baseUserMedia = createBaseUserMedia(scope, {
    ...inputs,
    statsType: "outbound-rtp",
  });

  /**
   * The local video track and the direction its camera faces, updated whenever
   * the track changes, the camera is switched, or the track is muted.
   */
  const videoTrack$ = state<{
    track: LocalVideoTrack;
    facingMode: string | undefined;
  } | null>(null);
  scope.effect(() => {
    const track = baseUserMedia.video$.value?.publication.track;
    if (!(track instanceof LocalVideoTrack)) {
      videoTrack$.value = null;
      return;
    }
    const update = (): void => {
      videoTrack$.value = {
        track,
        facingMode: facingModeFromLocalTrack(track).facingMode,
      };
    };
    const mute = (): void => {
      videoTrack$.value = null;
    };
    update();
    // Track restarts indicate a camera switch. This event is also emitted when
    // unmuting the track object.
    track.on(TrackEvent.Restarted, update);
    track.on(TrackEvent.Muted, mute);
    return (): void => {
      track.off(TrackEvent.Restarted, update);
      track.off(TrackEvent.Muted, mute);
    };
  });

  return {
    ...baseUserMedia,
    local: true,
    // Mirror only front-facing cameras (those that face the user)
    mirror$: computed(() => videoTrack$.value?.facingMode === "user"),
    alwaysShow$: alwaysShowSelf.value$,
    setAlwaysShow: alwaysShowSelf.setValue,
    switchCamera$: computed(() => {
      if (platform === "desktop") return null;
      if (videoTrack$.value === null) return null;
      const { track, facingMode } = videoTrack$.value;
      // If the camera isn't front or back-facing, don't provide a switch
      // camera shortcut at all
      if (facingMode !== "user" && facingMode !== "environment") return null;
      // Restart the track with a camera facing the opposite direction
      return (): void =>
        void track
          .restartTrack({
            facingMode: facingMode === "user" ? "environment" : "user",
          })
          .then(() => {
            // Inform the MediaDevices which camera was chosen
            const deviceId = track.mediaStreamTrack.getSettings().deviceId;
            if (deviceId !== undefined)
              mediaDevices.videoInput.select(deviceId);
          })
          .catch((e) => logger.error("Failed to switch camera", facingMode, e));
    }),
  };
}
