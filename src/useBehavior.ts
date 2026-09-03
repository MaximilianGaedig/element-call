/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { effect, untracked } from "@preact/signals-core";

import { type Behavior, state } from "./state/Behavior";
import { useInitial } from "./useInitial";
import { useLatest } from "./useLatest";

/**
 * React hook which reactively reads the value of a behavior.
 */
export function useBehavior<T>(behavior: Behavior<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => behavior.subscribe(onChange),
    [behavior],
  );
  const getValue = useCallback(() => behavior.value, [behavior]);
  return useSyncExternalStore(subscribe, getValue);
}

/**
 * Exposes a value from React's world as a Behavior, for handing to code that
 * lives outside React.
 */
export function useValueBehavior<T>(value: T): Behavior<T> {
  const state$ = useInitial(() => state(value));
  useEffect(() => {
    state$.value = value;
  }, [state$, value]);
  return state$;
}

/**
 * React hook which runs a callback whenever a Behavior changes, without
 * re-rendering the component. The callback also sees the previous value.
 */
export function useBehaviorChange<T>(
  behavior$: Behavior<T>,
  onChange: (current: T, previous: T) => void,
): void {
  const onChangeRef = useLatest(onChange);
  useEffect(() => {
    let previous = behavior$.value;
    return effect(() => {
      const current = behavior$.value;
      if (current !== previous)
        untracked(() => onChangeRef.current(current, previous));
      previous = current;
    });
  }, [behavior$, onChangeRef]);
}
