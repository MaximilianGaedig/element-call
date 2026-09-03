/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CallViewModel } from "../state/CallViewModel/CallViewModel.ts";
import { computed } from "../state/Behavior.ts";
import { createStaticViewModel, type ViewModel } from "../state/ViewModel.ts";
import { type DeveloperSettingsSnapshot } from "./DeveloperSettingsTab.tsx";

/**
 * Creates the ViewModel for the developer settings tab while in a call.
 *
 * Only the call state the tab actually renders is projected here, so that the
 * tab does not need to know about the CallViewModel.
 *
 * @param callModel - The root CallViewModel; provides the key rotation state.
 */
export function createDeveloperSettingsTabViewModel(
  callModel: CallViewModel,
): ViewModel<DeveloperSettingsSnapshot> {
  return {
    keyRotation$: computed(() => ({
      suppressed: callModel.keyRotationSuppressed$.value,
      participantCount: callModel.participantCount$.value,
    })),
  };
}

/**
 * The ViewModel for the developer settings tab outside of a call (lobby, user
 * menu), where no call state exists. All call specific fields are `null`.
 */
export const outOfCallDeveloperSettingsTabViewModel: ViewModel<DeveloperSettingsSnapshot> =
  createStaticViewModel<DeveloperSettingsSnapshot>({ keyRotation: null });
