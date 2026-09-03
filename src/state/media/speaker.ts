/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Behavior, state } from "../Behavior";
import { type ObservableScope } from "../ObservableScope";

/**
 * Whether someone counts as a speaker: it takes 1 second of continuous
 * speaking to become one, and 60 seconds of continuous silence to stop being
 * one.
 */
export function speaker$(
  scope: ObservableScope,
  speaking$: Behavior<boolean>,
): Behavior<boolean> {
  const speaker$ = state(false);
  scope.effect(() => {
    const speaking = speaking$.value;
    if (speaking === speaker$.peek()) return;
    const timer = setTimeout(
      () => {
        speaker$.value = speaking;
      },
      speaking ? 1000 : 60000,
    );
    return (): void => clearTimeout(timer);
  });
  return speaker$;
}
