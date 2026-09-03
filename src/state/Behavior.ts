/*
Copyright 2025, 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { Observable, type Subscriber } from "rxjs";
import {
  computed as computedSignal,
  effect,
  signal,
  untracked,
  type ReadonlySignal,
  type Signal,
} from "@preact/signals-core";

const noError = Symbol("noError");

/**
 * A value that changes over time. Read it synchronously with `.value`, or read
 * it inside `computed` / `scope.effect` to be re-run whenever it changes.
 *
 * While the migration off rxjs is in progress, a Behavior is also an rxjs
 * Observable, so existing pipelines can subscribe to it. Both `BehaviorSubject`
 * and `State` satisfy this interface.
 */
export interface Behavior<T> extends Observable<T> {
  readonly value: T;
}

/**
 * A writable Behavior, backed by a signal.
 */
export class State<T> extends Observable<T> implements Behavior<T> {
  private readonly signal$: Signal<T>;
  private readonly subscribers: Set<Subscriber<T>>;
  private readonly errorBox: { error: unknown };
  private notifying = false;
  private changedWhileNotifying = false;

  public constructor(signal$: Signal<T>) {
    // Locals rather than fields because `this` can't be used before super()
    const subscribers = new Set<Subscriber<T>>();
    const errorBox = { error: noError as unknown };
    super((subscriber) => {
      if (errorBox.error !== noError) {
        subscriber.error(errorBox.error);
        return;
      }
      subscribers.add(subscriber);
      subscriber.next(signal$.peek());
      return () => subscribers.delete(subscriber);
    });
    this.signal$ = signal$;
    this.subscribers = subscribers;
    this.errorBox = errorBox;
  }

  public get value(): T {
    if (this.errorBox.error !== noError) throw this.errorBox.error;
    return this.signal$.value;
  }

  public set value(value: T) {
    if (value === this.signal$.peek()) return;
    this.signal$.value = value;
    this.notify();
  }

  /**
   * Reads the value without registering a dependency on it.
   */
  public peek(): T {
    return this.signal$.peek();
  }

  /**
   * Puts the State into an error state: reading the value throws, and rxjs
   * subscribers receive the error. Only for compatibility with pipelines that
   * still use rxjs errors; model errors as values instead.
   */
  public fail(error: unknown): void {
    this.errorBox.error = error;
    for (const subscriber of this.subscribers) subscriber.error(error);
    this.subscribers.clear();
  }

  // Deliver the latest value to rxjs subscribers in subscription order, like a
  // BehaviorSubject does. Unlike a BehaviorSubject, if a subscriber
  // synchronously sets a new value, remaining subscribers see only the latest
  // value rather than being left on a stale one.
  private notify(): void {
    if (this.notifying) {
      this.changedWhileNotifying = true;
      return;
    }
    this.notifying = true;
    do {
      this.changedWhileNotifying = false;
      const value = this.signal$.peek();
      for (const subscriber of this.subscribers) {
        subscriber.next(value);
        if (this.changedWhileNotifying) break;
      }
    } while (this.changedWhileNotifying);
    this.notifying = false;
  }
}

class Derived<T> extends Observable<T> implements Behavior<T> {
  public constructor(private readonly signal$: ReadonlySignal<T>) {
    super((subscriber) =>
      effect(() => {
        const value = signal$.value;
        // Don't let anything the subscriber does become a dependency of ours
        untracked(() => subscriber.next(value));
      }),
    );
  }

  public get value(): T {
    return this.signal$.value;
  }
}

export function state<T>(value: T): State<T> {
  return new State(signal(value));
}

/**
 * A Behavior derived from other Behaviors. `fn` is re-run whenever a Behavior
 * it read has changed, and only when someone reads the result.
 */
export function computed<T>(fn: () => T): Behavior<T> {
  return new Derived(computedSignal(fn));
}

export function constant<T>(value: T): Behavior<T> {
  return state(value);
}
