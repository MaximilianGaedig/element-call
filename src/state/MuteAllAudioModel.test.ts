/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, vi } from "vitest";
import { expect } from "vitest";

import { audioEnabled$ } from "../controls";
import { muteAllAudio as muteAllAudioSetting } from "../settings/settings";
import { muteAllAudio$ } from "./MuteAllAudioModel";

test("muteAllAudio$", () => {
  const valueMock = vi.fn();
  const muteAllAudio = muteAllAudio$.subscribe((value) => {
    valueMock(value);
  });

  audioEnabled$.value = false;
  audioEnabled$.value = true;
  muteAllAudioSetting.setValue(false);
  muteAllAudioSetting.setValue(true);
  audioEnabled$.value = false;

  muteAllAudio();

  expect(valueMock).toHaveBeenCalledTimes(4);
  expect(valueMock).toHaveBeenNthCalledWith(1, false); // initial value
  expect(valueMock).toHaveBeenNthCalledWith(2, true); // audioEnabled$.value = false;
  expect(valueMock).toHaveBeenNthCalledWith(3, false); // audioEnabled$.value = true;
  expect(valueMock).toHaveBeenNthCalledWith(4, true); // muteAllAudioSetting.setValue(true);
});
