/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  BehaviorSubject,
  catchError,
  EMPTY,
  endWith,
  filter,
  type Observable,
  share,
  take,
  takeUntil,
} from "rxjs";

import { effect, signal } from "@preact/signals-core";

import { type Behavior, State } from "./Behavior";

type MonoTypeOperator = <T>(o: Observable<T>) => Observable<T>;

const nothing = Symbol("nothing");

/**
 * A scope which limits the execution lifetime of its bound Observables.
 */
export class ObservableScope {
  private readonly ended$ = new BehaviorSubject(false);

  private readonly bindImpl: MonoTypeOperator = takeUntil(
    this.ended$.pipe(filter((ended) => ended)),
  );

  /**
   * Binds an Observable to this scope, so that it completes when the scope
   * ends.
   */
  public bind(): MonoTypeOperator {
    return this.bindImpl;
  }

  private readonly shareImpl: MonoTypeOperator = share({
    resetOnError: false,
    resetOnComplete: false,
    resetOnRefCountZero: false,
  });
  /**
   * Shares (multicasts) the Observable as a hot Observable.
   */
  public readonly share: MonoTypeOperator = (input$) =>
    input$.pipe(this.bindImpl, this.shareImpl);

  /**
   * Converts an Observable to a Behavior. If no initial value is specified, the
   * Observable must synchronously emit an initial value.
   */
  public behavior<T>(
    setValue$: Observable<T>,
    initialValue: T | typeof nothing = nothing,
  ): Behavior<T> {
    const state$ = new State<T | typeof nothing>(signal(initialValue));
    setValue$.pipe(this.bind()).subscribe({
      next(value) {
        state$.value = value;
      },
      error(err: unknown) {
        state$.fail(err);
      },
    });
    if (state$.peek() === nothing)
      throw new Error("Behavior failed to synchronously emit an initial value");
    return state$ as Behavior<T>;
  }

  /**
   * Runs `fn` now and again whenever a Behavior it read has changed, until the
   * scope ends. `fn` may return a clean-up function.
   */
  public effect(fn: () => void | (() => void)): void {
    this.onEnd(effect(fn));
  }

  /**
   * Ends the scope, causing any bound Observables to complete.
   */
  public end(): void {
    this.ended$.next(true);
  }

  /**
   * Register a callback to be executed when the scope is ended.
   */
  public onEnd(callback: () => void): void {
    this.ended$
      .pipe(
        filter((ended) => ended),
        take(1),
      )
      .subscribe(callback);
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
    let latestValue: T | typeof nothing = nothing;
    let reconcilePromise: Promise<void> | undefined = undefined;
    let cleanUp: (() => Promise<void>) | void = undefined;
    let prevVal: T | typeof nothing = nothing;

    // While this loop runs it will process the latest from `value$` until it caught up with the updates.
    // It might skip updates from `value$` and only process the newest value after callback has resolved.
    const reconcileLoop = async (): Promise<void> => {
      while (latestValue !== prevVal) {
        await cleanUp?.(); // Call the previous value's clean-up handler
        prevVal = latestValue;

        if (latestValue !== nothing) cleanUp = await callback(latestValue); // Sync current value...
        // `latestValue` might have gotten updated during the `await callback`. That is why we loop here
      }
    };

    value$
      .pipe(
        catchError(() => EMPTY), // Ignore errors
        this.bind(), // Limit to the duration of the scope
        endWith(nothing), // Clean up when the scope ends
      )
      .subscribe((value) => {
        // Always track the latest value! The `reconcileLoop` will run until it "processed" the "last" `latestValue`.
        latestValue = value;
        // There's already an instance of the below 'reconcileLoop' loop running
        // concurrently. So lets let the loop handle it. NEVER instanciate two `reconcileLoop`s.
        if (reconcilePromise) return;

        reconcilePromise = reconcileLoop().finally(() => {
          reconcilePromise = undefined;
        });
      });
  }
}

/**
 * The global scope, a scope which never ends.
 */
export const globalScope = new ObservableScope();
