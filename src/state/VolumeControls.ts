/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Behavior, computed, state } from "./Behavior";
import { type Scope } from "./Scope";

/**
 * Controls for audio playback volume.
 */
export interface VolumeControls {
  /**
   * The volume to which the audio is set, as a scalar multiplier.
   */
  playbackVolume$: Behavior<number>;
  /**
   * Whether playback of this audio is disabled.
   */
  playbackMuted$: Behavior<boolean>;
  togglePlaybackMuted: () => void;
  adjustPlaybackVolume: (value: number) => void;
  commitPlaybackVolume: () => void;
}

interface VolumeControlsInputs {
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * The callback to run to notify the module performing audio playback of the
   * requested volume.
   */
  sink$: Behavior<(volume: number) => void>;
}

/**
 * Creates a set of controls for audio playback volume and syncs this with the
 * audio playback module for the duration of the scope.
 */
export function createVolumeControls(
  scope: Scope,
  { pretendToBeDisconnected$, sink$ }: VolumeControlsInputs,
): VolumeControls {
  const playbackVolume$ = state(1);
  // The volume to return to when unmuting
  let committedVolume = 1;

  // Sync the requested volume with the audio playback module, taking into
  // account whether we're supposed to pretend that the audio stream is
  // disconnected (since we don't necessarily want that to modify the UI state)
  scope.effect(() =>
    sink$.value(pretendToBeDisconnected$.value ? 0 : playbackVolume$.value),
  );

  return {
    playbackVolume$,
    playbackMuted$: computed(() => playbackVolume$.value === 0),
    togglePlaybackMuted: () => {
      playbackVolume$.value = playbackVolume$.value === 0 ? committedVolume : 0;
    },
    adjustPlaybackVolume: (value) => {
      playbackVolume$.value = value;
    },
    commitPlaybackVolume: () => {
      // Dragging the slider to zero should have the same effect as muting: keep
      // the original committed volume, as if it were never dragged
      if (playbackVolume$.value !== 0) committedVolume = playbackVolume$.value;
    },
  };
}
