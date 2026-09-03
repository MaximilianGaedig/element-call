/*
Copyright 2025, 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  computed as computedSignal,
  type ReadonlySignal,
  Signal,
  signal,
  untracked,
} from "@preact/signals-core";

import { type ObservableScope } from "./ObservableScope";

const nothing = Symbol("nothing");

/**
 * A value that changes over time. Read it synchronously with `.value`, or read
 * it inside `computed` / `scope.effect` to be re-run whenever it changes.
 * `.peek()` reads it without creating a dependency.
 */
export type Behavior<T> = ReadonlySignal<T>;

/**
 * A Behavior that can be written to. Writing the same value again does nothing.
 */
export type State<T> = Signal<T>;

export function state<T>(value: T): State<T> {
  return signal(value);
}

/**
 * A Behavior derived from other Behaviors. `fn` is re-run whenever a Behavior
 * it read has changed, and only when someone reads the result.
 *
 * @param equals If given, a new result that is equal to the previous one is
 *   dropped, so that dependents don't re-run.
 */
export function computed<T>(
  fn: () => T,
  equals?: (a: T, b: T) => boolean,
): Behavior<T> {
  if (equals === undefined) return computedSignal(fn);
  let prev: T | typeof nothing = nothing;
  return computedSignal(() => {
    const next = fn();
    if (prev !== nothing && equals(prev, next)) return prev;
    prev = next;
    return next;
  });
}

export function constant<T>(value: T): Behavior<T> {
  return signal(value);
}

/**
 * Anything with Node-style `on`/`off`, such as a LiveKit Room or Participant or
 * a matrix-js-sdk emitter.
 */
export interface Emitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: any, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: any, listener: (...args: any[]) => void): unknown;
}

/**
 * A Behavior holding the result of `read`, re-read whenever the emitter emits
 * any of `events`, until the scope ends. The emitter may itself be a Behavior
 * (for example a participant that comes and goes), in which case the listeners
 * follow it and `read` is also re-run whenever it changes.
 */
export function fromEvents<E extends Emitter, T>(
  scope: ObservableScope,
  emitter: E,
  events: readonly (string | symbol)[],
  read: (emitter: E) => T,
): Behavior<T>;
export function fromEvents<E extends Emitter, T>(
  scope: ObservableScope,
  emitter$: Behavior<E | null | undefined>,
  events: readonly (string | symbol)[],
  read: (emitter: E | null | undefined) => T,
): Behavior<T>;
export function fromEvents<E extends Emitter, T>(
  scope: ObservableScope,
  emitter: E | Behavior<E | null | undefined>,
  events: readonly (string | symbol)[],
  read: (emitter: E | null | undefined) => T,
): Behavior<T> {
  const emitter$: Behavior<E | null | undefined> =
    emitter instanceof Signal ? emitter : constant(emitter as E);
  const value$ = state<T>(undefined as T);
  scope.effect(() => {
    const e = emitter$.value;
    const update = (): void => {
      value$.value = untracked(() => read(e));
    };
    update();
    if (!e) return;
    for (const event of events) e.on(event, update);
    return (): void => {
      for (const event of events) e.off(event, update);
    };
  });
  return value$;
}
