/*
Copyright 2026 Element Corp.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room as LivekitRoom } from "livekit-client";

import { Scope } from "./Scope";
import { constant } from "./Behavior";
import { type SelectedAudioOutputDevice } from "./MediaDevices";
import {
  availableOutputDevices$,
  type Controls,
  type OutputDevice,
  outputDevice$,
} from "../controls";
import {
  EARPIECE_CONFIG_ID,
  IOSControlledAudioOutput,
} from "./IOSControlledAudioOutput";

// `vi.mock` calls are hoisted above all imports, so the static imports below
// already see this mock. Force the iOS platform so that the virtual earpiece
// is available.
vi.mock("../Platform", () => ({ platform: "ios" }));

// On iOS the host reports a single device for the current route. When output is
// on the loudspeaker it is flagged `forEarpiece`, which makes the controller
// expose a virtual earpiece device.
const SPEAKER: OutputDevice = {
  id: "speaker",
  name: "Speaker",
  isSpeaker: true,
  forEarpiece: true,
};

// A connected headset (e.g. Bluetooth) is reported as a plain named device,
// with neither the speaker nor earpiece flag set.
const HEADSET: OutputDevice = {
  id: "bt",
  name: "AirPods",
};

let testScope: Scope;

beforeEach(() => {
  testScope = new Scope();
  // Device enumeration is only used for its side effects here
  vi.spyOn(LivekitRoom, "getLocalDevices").mockResolvedValue([]);
  availableOutputDevices$.value = [];
  outputDevice$.value = undefined;
  window.controls = {
    onAudioDeviceSelect: vi.fn(),
    onOutputDeviceSelect: vi.fn(),
  } as unknown as Controls;
});

afterEach(() => {
  testScope.end();
  vi.restoreAllMocks();
});

/**
 * Subscribe to the controller's `selected$` and return a getter for the latest
 * emitted value.
 */
function latestSelection(
  output: InstanceType<typeof IOSControlledAudioOutput>,
): () => SelectedAudioOutputDevice | undefined {
  let latest: SelectedAudioOutputDevice | undefined;
  output.selected$.subscribe((s) => {
    latest = s;
  });
  return () => latest;
}

describe("Default selection", () => {
  it("defaults to the earpiece for voice (audio) calls", () => {
    const output = new IOSControlledAudioOutput(
      constant(false),
      testScope,
      "audio",
    );
    const selected = latestSelection(output);

    availableOutputDevices$.value = [SPEAKER];

    expect(selected()).toEqual({
      id: EARPIECE_CONFIG_ID,
      virtualEarpiece: true,
    });
    expect(window.controls.onAudioDeviceSelect).toHaveBeenLastCalledWith(
      EARPIECE_CONFIG_ID,
    );
  });

  it("defaults to the speaker for video calls", () => {
    const output = new IOSControlledAudioOutput(
      constant(false),
      testScope,
      "video",
    );
    const selected = latestSelection(output);

    availableOutputDevices$.value = [SPEAKER];

    expect(selected()).toEqual({ id: SPEAKER.id, virtualEarpiece: false });
  });

  it("keeps a headset for voice calls instead of forcing the earpiece", () => {
    const output = new IOSControlledAudioOutput(
      constant(false),
      testScope,
      "audio",
    );
    const selected = latestSelection(output);

    // The host proposes the headset as the route (listed first), even though a
    // forEarpiece device is also present so the virtual earpiece exists.
    availableOutputDevices$.value = [HEADSET, SPEAKER];

    expect(selected()).toEqual({ id: HEADSET.id, virtualEarpiece: false });
  });
});

describe("Explicit selection", () => {
  it("an explicit user selection overrides the earpiece default", () => {
    const output = new IOSControlledAudioOutput(
      constant(false),
      testScope,
      "audio",
    );
    const selected = latestSelection(output);

    availableOutputDevices$.value = [SPEAKER];
    // Earpiece by default for a voice call...
    expect(selected()).toEqual({
      id: EARPIECE_CONFIG_ID,
      virtualEarpiece: true,
    });

    // ...until the user explicitly picks the speaker.
    output.select(SPEAKER.id);
    expect(selected()).toEqual({ id: SPEAKER.id, virtualEarpiece: false });
  });

  it("a host selection overrides the earpiece default", () => {
    const output = new IOSControlledAudioOutput(
      constant(false),
      testScope,
      "audio",
    );
    const selected = latestSelection(output);

    availableOutputDevices$.value = [SPEAKER];
    outputDevice$.value = SPEAKER.id;

    expect(selected()).toEqual({ id: SPEAKER.id, virtualEarpiece: false });
  });
});
