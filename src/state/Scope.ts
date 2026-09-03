/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { effect, untracked } from "@preact/signals-core";

import { type Behavior } from "./Behavior";

const nothing = Symbol("nothing");

/**
 * A scope which limits the lifetime of effects and other resources.
 */
export class Scope {
  private ended = false;
  private readonly endCallbacks: (() => void)[] = [];

  /**
   * Runs `fn` now and again whenever a Behavior it read has changed, until the
   * scope ends. `fn` may return a clean-up function.
   */
  public effect(fn: () => void | (() => void)): void {
    this.onEnd(effect(fn));
  }

  /**
   * Ends the scope, running all clean-up callbacks.
   */
  public end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const callback of this.endCallbacks) callback();
    this.endCallbacks.length = 0;
  }

  /**
   * Register a callback to be executed when the scope is ended. If the scope
   * has already ended, the callback runs immediately.
   */
  public onEnd(callback: () => void): void {
    if (this.ended) callback();
    else this.endCallbacks.push(callback);
  }

  /**
   * For the duration of the scope, sync some external state with the value of
   * the provided Behavior by way of an async function which attempts to update
   * (reconcile) the external state. The reconciliation function may return a
   * clean-up callback which will be called and awaited before the next change
   * in value (or the end of the scope).
   *
   * All calls to the function and its clean-up callbacks are serialized. If the
   * value changes faster than the handlers can keep up with, intermediate
   * values may be skipped.
   *
   * Basically, this is like React's useEffect but async and for Behaviors.
   */
  public reconcile<T>(
    value$: Behavior<T>,
    callback: (value: T) => Promise<(() => Promise<void>) | void>,
  ): void {
    let latest: T | typeof nothing = nothing;
    let processed: T | typeof nothing = nothing;
    let running = false;
    let cleanUp: (() => Promise<void>) | void = undefined;

    // Processes the latest value until caught up. Values that arrive while a
    // callback is in flight are coalesced into the next iteration.
    const run = async (): Promise<void> => {
      running = true;
      try {
        while (latest !== processed) {
          await cleanUp?.();
          processed = latest;
          cleanUp = latest === nothing ? undefined : await callback(latest);
        }
      } finally {
        running = false;
      }
    };
    const push = (value: T | typeof nothing): void => {
      latest = value;
      if (!running) void run();
    };

    this.effect(() => {
      const value = value$.value;
      // The callback's own reads must not become dependencies of this effect
      untracked(() => push(value));
    });
    this.onEnd(() => push(nothing));
  }
}

/**
 * The global scope, a scope which never ends.
 */
export const globalScope = new Scope();
