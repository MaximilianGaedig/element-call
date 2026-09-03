/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type Observable,
  audit,
  combineLatest,
  defer,
  filter,
  finalize,
  map,
  of,
  scan,
  tap,
  withLatestFrom,
  type OperatorFunction,
  distinctUntilChanged,
} from "rxjs";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior, state, type State } from "../state/Behavior";
import { ObservableScope } from "../state/ObservableScope";

const nothing = Symbol("nothing");

/**
 * RxJS operator that invokes a callback when the Observable is finalized,
 * passing the most recently emitted value. If no value was emitted, the
 * callback will not be invoked.
 */
export function finalizeValue<T>(callback: (finalValue: T) => void) {
  return (source$: Observable<T>): Observable<T> =>
    defer(() => {
      let finalValue: T | typeof nothing = nothing;
      return source$.pipe(
        tap((value) => (finalValue = value)),
        finalize(() => {
          if (finalValue !== nothing) callback(finalValue);
        }),
      );
    });
}

/**
 * Reads the current value of a state Observable without reacting to future
 * changes.
 *
 * This function exists to help with certain cases of bridging Observables into
 * React, where an initial value is needed. You should never use it to create an
 * Observable derived from another Observable; use reactive operators instead.
 */
export function getValue<T>(state$: Observable<T>): T {
  let value: T | typeof nothing = nothing;
  state$.subscribe((x) => (value = x)).unsubscribe();
  if (value === nothing) throw new Error("Not a state Observable");
  return value;
}

/**
 * Creates an Observable that has a value of true whenever all its inputs are
 * true.
 *
 * @public
 */
export function and$(...inputs: Observable<boolean>[]): Observable<boolean> {
  return combineLatest(inputs, (...flags) => flags.every((flag) => flag));
}

/**
 * RxJS operator that pauses all changes in the input value whenever a Behavior
 * is true. When the Behavior returns to being false, the most recently
 * suppressed change is emitted as the most recent value.
 */
export function pauseWhen<T>(pause$: Behavior<boolean>) {
  return (value$: Observable<T>): Observable<T> =>
    value$.pipe(
      withLatestFrom(pause$),
      audit(([, pause]) =>
        pause ? pause$.pipe(filter((pause) => !pause)) : of(null),
      ),
      map(([value]) => value),
    );
}

interface ItemHandle<Keys extends unknown[], Data, Item> {
  scope: ObservableScope;
  keys: readonly [...Keys];
  data$: State<Data>;
  item: Item;
}

/**
 * Maps a changing input value to a collection of items that each capture some
 * dynamic data and are tied to a key. Items will be automatically created when
 * their key is requested for the first time, reused when the same key is
 * requested at a later time, and destroyed (have their scope ended) when the
 * key is no longer requested.
 *
 * @param name A name for this collection to use in debug logs.
 * @param generator A generator function yielding a tuple of keys and the
 *   currently associated data for each item that it wants to exist.
 * @param factory A function constructing an individual item, given the item's key,
 *   dynamic data, and an automatically managed ObservableScope for the item.
 */
export function generateItems<
  Input,
  Keys extends [unknown, ...unknown[]],
  Data,
  Item,
>(
  name: string,
  generator: (
    input: Input,
  ) => Iterable<{ keys: readonly [...Keys]; data: Data }, void, void>,
  factory: (
    scope: ObservableScope,
    data$: Behavior<Data>,
    ...keys: Keys
  ) => Item,
): OperatorFunction<Input, Item[]> {
  return generateItemsInternal(name, generator, factory, (items) => items);
}

/**
 * Segments a behavior into periods during which its value matches the filter
 * (outputting a behavior with a narrowed type) and periods during which it does
 * not match (outputting null).
 */
export function filterBehavior<T, S extends T>(
  predicate: (value: T) => value is S,
): OperatorFunction<T, Behavior<S> | null> {
  return (input$) =>
    input$.pipe(
      scan<T, State<S> | null>((acc$, input) => {
        if (predicate(input)) {
          const output$ = acc$ ?? state(input);
          output$.value = input;
          return output$;
        }
        return null;
      }, null),
      distinctUntilChanged(),
    );
}

function generateItemsInternal<
  Input,
  Keys extends [unknown, ...unknown[]],
  Data,
  Item,
  Output,
>(
  name: string,
  generator: (
    input: Input,
  ) => Iterable<{ keys: readonly [...Keys]; data: Data }, void, void>,
  factory: (
    scope: ObservableScope,
    data$: Behavior<Data>,
    ...keys: Keys
  ) => Item,
  project: (items: Item[], input: Input) => Output,
): OperatorFunction<Input, Output> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (input$) =>
    input$.pipe(
      // Keep track of the existing items over time, so they can persist
      scan<
        Input,
        {
          map: Map<any, any>;
          items: Set<ItemHandle<Keys, Data, Item>>;
          input: Input;
        },
        { map: Map<any, any>; items: Set<ItemHandle<Keys, Data, Item>> }
      >(
        ({ map: prevMap, items: prevItems }, input) => {
          const nextMap = new Map();
          const nextItems = new Set<ItemHandle<Keys, Data, Item>>();

          for (const { keys, data } of generator(input)) {
            // Disable type checks for a second to grab the item out of a nested map
            let i: any = prevMap;
            for (const key of keys) i = i?.get(key);
            let item = i as ItemHandle<Keys, Data, Item> | undefined;

            if (item === undefined) {
              // First time requesting the key; create the item
              const scope = new ObservableScope();
              const data$ = state(data);
              logger.debug(
                `[${name}] Creating item with keys ${keys.join(", ")}`,
              );
              item = {
                scope,
                keys,
                data$,
                item: factory(scope, data$, ...keys),
              };
            } else {
              item.data$.value = data;
            }

            // Likewise, disable type checks to insert the item in the nested map
            let m: Map<any, any> = nextMap;
            for (let i = 0; i < keys.length - 1; i++) {
              let inner = m.get(keys[i]);
              if (inner === undefined) {
                inner = new Map();
                m.set(keys[i], inner);
              }
              m = inner;
            }
            const finalKey = keys[keys.length - 1];
            if (m.has(finalKey))
              throw new Error(
                `Keys must be unique (tried to generate multiple items for key ${keys.join(", ")})`,
              );
            m.set(keys[keys.length - 1], item);
            nextItems.add(item);
          }

          // Destroy all items that are no longer being requested
          for (const item of prevItems)
            if (!nextItems.has(item)) {
              logger.debug(
                `[${name}] Destroying item with keys ${item.keys.join(", ")}`,
              );
              item.scope.end();
            }

          return { map: nextMap, items: nextItems, input };
        },
        { map: new Map(), items: new Set() },
      ),
      finalizeValue(({ items }) => {
        // Destroy all remaining items when no longer subscribed
        logger.debug(
          `[${name}] End of scope, destroying all ${items.size} items…`,
        );
        for (const item of items) {
          logger.debug(
            `[${name}] Destroying item with keys ${item.keys.join(", ")}`,
          );
          item.scope.end();
        }
      }),
      map(({ items, input }) =>
        project(
          [...items].map(({ item }) => item),
          input,
        ),
      ),
    );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
