/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useRef } from "react";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import joinCallSoundMp3 from "../sound/join_call.mp3";
import joinCallSoundOgg from "../sound/join_call.ogg";
import leftCallSoundMp3 from "../sound/left_call.mp3";
import leftCallSoundOgg from "../sound/left_call.ogg";
import handSoundOgg from "../sound/raise_hand.ogg";
import handSoundMp3 from "../sound/raise_hand.mp3";
import screenShareStartedOgg from "../sound/screen_share_started.ogg";
import screenShareStartedMp3 from "../sound/screen_share_started.mp3";
import declineMp3 from "../sound/call_declined.mp3?url";
import declineOgg from "../sound/call_declined.ogg?url";
import timeoutMp3 from "../sound/call_timeout.mp3?url";
import timeoutOgg from "../sound/call_timeout.ogg?url";
import recordingStartedMp3 from "../sound/recording_started.mp3";
import recordingStartedOgg from "../sound/recording_started.ogg";
import recordingStoppedMp3 from "../sound/recording_stopped.mp3";
import recordingStoppedOgg from "../sound/recording_stopped.ogg";
import { useAudioContext } from "../useAudioContext";
import { prefetchSounds } from "../soundUtils";
import { useLatest } from "../useLatest";
import { useBehaviorChange } from "../useBehavior";

export const callEventAudioSounds = prefetchSounds({
  join: {
    mp3: joinCallSoundMp3,
    ogg: joinCallSoundOgg,
  },
  left: {
    mp3: leftCallSoundMp3,
    ogg: leftCallSoundOgg,
  },
  raiseHand: {
    mp3: handSoundMp3,
    ogg: handSoundOgg,
  },
  screenshareStarted: {
    mp3: screenShareStartedMp3,
    ogg: screenShareStartedOgg,
  },
  decline: {
    mp3: declineMp3,
    ogg: declineOgg,
  },
  timeout: {
    mp3: timeoutMp3,
    ogg: timeoutOgg,
  },
  recordingStarted: {
    mp3: recordingStartedMp3,
    ogg: recordingStartedOgg,
  },
  recordingStopped: {
    mp3: recordingStoppedMp3,
    ogg: recordingStoppedOgg,
  },
});

export type CallEventSounds = keyof Awaited<typeof callEventAudioSounds>;

// Do not play any sounds if the participant count has exceeded this number.
export const MAX_PARTICIPANT_COUNT_FOR_SOUND = 8;
export const THROTTLE_SOUND_EFFECT_MS = 500;

export function CallEventAudioRenderer({
  vm,
  muted,
}: {
  vm: CallViewModel;
  muted?: boolean;
}): ReactNode {
  const audioEngineCtx = useAudioContext({
    sounds: callEventAudioSounds,
    latencyHint: "interactive",
    muted,
  });
  const audioEngineRef = useLatest(audioEngineCtx);
  const play = (sound: CallEventSounds): void =>
    void audioEngineRef.current?.playSound(sound);

  // People joining and leaving, at most once every THROTTLE_SOUND_EFFECT_MS
  const lastPresenceSound = useRef(-Infinity);
  useBehaviorChange(vm.participantCount$, (count, previous) => {
    if (count > MAX_PARTICIPANT_COUNT_FOR_SOUND) return;
    // Avoid doubling up on any auto-leave sounds (e.g. the decline sound),
    // which are handled elsewhere
    if (count < previous && vm.leaveReason$.value !== null) return;
    const now = Date.now();
    if (now - lastPresenceSound.current < THROTTLE_SOUND_EFFECT_MS) return;
    lastPresenceSound.current = now;
    play(count > previous ? "join" : "left");
  });
  useBehaviorChange(vm.handsRaised$, (hands, previous) => {
    if (Object.keys(hands).length > Object.keys(previous).length)
      play("raiseHand");
  });
  useBehaviorChange(vm.screenShares$, (shares, previous) => {
    if (shares.length > previous.length) play("screenshareStarted");
  });
  // Everyone hears when a recording starts and stops, however big the call
  useBehaviorChange(vm.recording.recording$, (recording, previous) => {
    if (recording !== null && previous === null) play("recordingStarted");
    else if (recording === null && previous !== null) play("recordingStopped");
  });

  return <></>;
}
