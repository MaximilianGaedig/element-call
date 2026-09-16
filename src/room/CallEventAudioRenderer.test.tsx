/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { render } from "@testing-library/react";
import {
  beforeEach,
  expect,
  type MockedFunction,
  test,
  vitest,
  afterEach,
} from "vitest";
import { act } from "react";
import { type RoomMember } from "matrix-js-sdk";
import {
  type LivekitTransport,
  type CallMembership,
} from "matrix-js-sdk/lib/matrixrtc";

import {
  exampleTransport,
  mockMatrixRoomMember,
  mockRtcMembership,
} from "../utils/test";
import {
  CallEventAudioRenderer,
  MAX_PARTICIPANT_COUNT_FOR_SOUND,
} from "./CallEventAudioRenderer";
import { useAudioContext } from "../useAudioContext";
import { prefetchSounds } from "../soundUtils";
import { getBasicCallViewModelEnvironment } from "../utils/test-viewmodel";
import {
  alice,
  aliceRtcMember,
  bob,
  bobRtcMember,
  local,
  localRtcMember,
} from "../utils/test-fixtures";
import { initializeWidget } from "../widget";
import { state } from "../state/Behavior";
import {
  ConsentDeclinedError,
  RecorderError,
  type RecordingState,
} from "../state/Recording";
initializeWidget();
vitest.mock("livekit-client/e2ee-worker?worker");
vitest.mock("../useAudioContext");
vitest.mock("../soundUtils");
vitest.mock("../rtcSessionHelpers", async (importOriginal) => ({
  ...(await importOriginal()),
  makeTransport: (): [LivekitTransport] => [exampleTransport],
}));

afterEach(() => {
  vitest.clearAllMocks();
});

let playSound: MockedFunction<
  NonNullable<ReturnType<typeof useAudioContext>>["playSound"]
>;

beforeEach(() => {
  (prefetchSounds as MockedFunction<typeof prefetchSounds>).mockResolvedValue({
    sound: new ArrayBuffer(0),
  });
  playSound = vitest.fn();
  (useAudioContext as MockedFunction<typeof useAudioContext>).mockReturnValue({
    playSound,
    playSoundLooping: vitest.fn(),
    soundDuration: {},
  });
});

/**
 * We don't want to play a sound when loading the call state
 * because typically this occurs in two stages. We first join
 * the call as a local participant and *then* the remote
 * participants join from our perspective. We don't want to make
 * a noise every time.
 */
test("plays one sound when entering a call", () => {
  const { vm, rtcMemberships$ } = getBasicCallViewModelEnvironment([
    local,
    alice,
    bob,
  ]);
  render(<CallEventAudioRenderer vm={vm} />);

  // Joining a call usually means remote participants are added later.
  act(() => {
    rtcMemberships$.value = [localRtcMember, aliceRtcMember, bobRtcMember];
  });
  expect(playSound).toHaveBeenCalledOnce();
});

test("plays a sound when a user joins", () => {
  const { vm, rtcMemberships$ } = getBasicCallViewModelEnvironment([
    local,
    alice,
    bob,
  ]);
  render(<CallEventAudioRenderer vm={vm} />);

  act(() => {
    rtcMemberships$.value = [localRtcMember, aliceRtcMember, bobRtcMember];
  });
  // Play a sound when joining a call.
  expect(playSound).toBeCalledWith("join");
});

test("plays a sound when a user leaves", () => {
  const { vm, rtcMemberships$ } = getBasicCallViewModelEnvironment([
    local,
    alice,
  ]);
  render(<CallEventAudioRenderer vm={vm} />);

  act(() => {
    rtcMemberships$.value = [localRtcMember];
  });
  expect(playSound).toBeCalledWith("left");
});

test("does not play a sound before the call is successful", () => {
  const { vm, rtcMemberships$ } = getBasicCallViewModelEnvironment(
    [local, alice],
    [localRtcMember],
    undefined,
    { waitForCallPickup: true },
  );
  render(<CallEventAudioRenderer vm={vm} />);

  act(() => {
    rtcMemberships$.value = [localRtcMember];
  });
  expect(playSound).not.toBeCalledWith("left");
});

test("plays no sound when the participant list is more than the maximum size", () => {
  const mockMembers: RoomMember[] = [local];
  const mockRtcMemberships: CallMembership[] = [localRtcMember];
  for (let i = 0; i < MAX_PARTICIPANT_COUNT_FOR_SOUND; i++) {
    const membership = mockRtcMembership(`@user${i}:example.org`, `DEVICE${i}`);
    mockMembers.push(mockMatrixRoomMember(membership));
    mockRtcMemberships.push(membership);
  }

  const { vm, rtcMemberships$ } = getBasicCallViewModelEnvironment(
    mockMembers,
    mockRtcMemberships,
  );

  render(<CallEventAudioRenderer vm={vm} />);
  expect(playSound).not.toBeCalled();
  // Remove the last membership in the array to test the leaving sound
  // (The array has length MAX_PARTICIPANT_COUNT_FOR_SOUND + 1)
  act(() => {
    rtcMemberships$.value = mockRtcMemberships.slice(
      0,
      MAX_PARTICIPANT_COUNT_FOR_SOUND,
    );
  });
  expect(playSound).toBeCalledWith("left");
});

test("plays one sound when a hand is raised", () => {
  const { vm, handRaisedSubject$ } = getBasicCallViewModelEnvironment([
    local,
    alice,
    bob,
  ]);
  render(<CallEventAudioRenderer vm={vm} />);

  act(() => {
    handRaisedSubject$.value = {
      // TODO: What is this string supposed to be?
      [`${bobRtcMember.userId}:${bobRtcMember.deviceId}`]: {
        time: new Date(),
        membershipEventId: "",
        reactionEventId: "",
      },
    };
  });
  expect(playSound).toBeCalledWith("raiseHand");
});

test("should not play a sound when a hand raise is retracted", () => {
  const { vm, handRaisedSubject$ } = getBasicCallViewModelEnvironment([
    local,
    alice,
  ]);
  render(<CallEventAudioRenderer vm={vm} />);

  playSound.mockClear();
  act(() => {
    handRaisedSubject$.value = {
      ["foo"]: {
        time: new Date(),
        membershipEventId: "",
        reactionEventId: "",
      },
      ["bar"]: {
        time: new Date(),
        membershipEventId: "",
        reactionEventId: "",
      },
    };
  });
  expect(playSound).toHaveBeenCalledExactlyOnceWith("raiseHand");
  act(() => {
    handRaisedSubject$.value = {
      ["foo"]: {
        time: new Date(),
        membershipEventId: "",
        reactionEventId: "",
      },
    };
  });
  expect(playSound).toHaveBeenCalledExactlyOnceWith("raiseHand");
});

function recordingRequest(started: boolean): RecordingState {
  return {
    by: alice.userId,
    recorder: "@bot:example.org",
    media: "video",
    streams: "composite",
    eventId: "$request",
    started,
    requiresConsent: true,
    consents: {},
    awaitingConsent: started ? [] : [local.userId],
  };
}

test("announces a recording request, then its start and stop", () => {
  const { vm } = getBasicCallViewModelEnvironment([local, alice]);
  const recording$ = state<RecordingState | null>(null);
  vm.recording = { ...vm.recording, recording$ };
  render(<CallEventAudioRenderer vm={vm} />);

  playSound.mockClear();
  // The request alone, still awaiting consent, isn't a recording yet
  act(() => {
    recording$.value = recordingRequest(false);
  });
  expect(playSound).toHaveBeenCalledExactlyOnceWith("recordingRequested");
  act(() => {
    recording$.value = recordingRequest(true);
  });
  expect(playSound).toHaveBeenLastCalledWith("recordingStarted");
  act(() => {
    recording$.value = null;
  });
  expect(playSound).toHaveBeenLastCalledWith("recordingStopped");
  expect(playSound).toHaveBeenCalledTimes(3);
});

test("announces a recording request that whoever asked withdraws", () => {
  const { vm } = getBasicCallViewModelEnvironment([local, alice]);
  const recording$ = state<RecordingState | null>(null);
  const error$ = state<Error | null>(null);
  vm.recording = { ...vm.recording, recording$, error$ };
  render(<CallEventAudioRenderer vm={vm} />);

  playSound.mockClear();
  act(() => {
    recording$.value = recordingRequest(false);
  });
  act(() => {
    recording$.value = null;
  });
  expect(playSound).toHaveBeenLastCalledWith("recordingCancelled");
  expect(playSound).toHaveBeenCalledTimes(2);
});

test("announces a recording request that somebody declines", () => {
  const { vm } = getBasicCallViewModelEnvironment([local, alice]);
  const recording$ = state<RecordingState | null>(null);
  const error$ = state<Error | null>(null);
  vm.recording = { ...vm.recording, recording$, error$ };
  render(<CallEventAudioRenderer vm={vm} />);

  playSound.mockClear();
  act(() => {
    recording$.value = recordingRequest(false);
  });
  // Whoever asked gives up and clears the request
  act(() => {
    error$.value = new ConsentDeclinedError(local.userId);
    recording$.value = null;
  });
  expect(playSound).toHaveBeenLastCalledWith("recordingDenied");
  expect(playSound).toHaveBeenCalledTimes(2);
});

test("announces a recording request that the recorder never confirms", () => {
  const { vm } = getBasicCallViewModelEnvironment([local, alice]);
  const recording$ = state<RecordingState | null>(null);
  const error$ = state<Error | null>(null);
  vm.recording = { ...vm.recording, recording$, error$ };
  render(<CallEventAudioRenderer vm={vm} />);

  playSound.mockClear();
  act(() => {
    recording$.value = recordingRequest(false);
  });
  act(() => {
    error$.value = new RecorderError();
    recording$.value = null;
  });
  expect(playSound).toHaveBeenLastCalledWith("recordingFailed");
  expect(playSound).toHaveBeenCalledTimes(2);
});
