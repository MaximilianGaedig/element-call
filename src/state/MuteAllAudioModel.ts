/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { audioEnabled$ } from "../controls";
import { muteAllAudio as muteAllAudioSetting } from "../settings/settings";
import { computed } from "./Behavior";

/**
 * This can transition into sth more complete: `GroupCallViewModel.ts`
 */
export const muteAllAudio$ = computed(
  () => !audioEnabled$.value || muteAllAudioSetting.value$.value,
);
