/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { untracked } from "@preact/signals-core";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior, state, type State } from "./Behavior";
import { ObservableScope } from "./ObservableScope";
import { shallowEquals } from "../utils/array";

interface Entry<Data, Item> {
  scope: ObservableScope;
  keys: readonly unknown[];
  data$: State<Data>;
  item: Item;
}

/**
 * Maps a changing input to a collection of items that each capture some
 * dynamic data and are tied to a key. Items are created when their key is
 * first requested, reused (with their data updated) while the key persists,
 * and destroyed (have their scope ended) when the key is no longer requested
 * or the parent scope ends. Items are returned in generator order.
 *
 * @param name A name for this collection to use in debug logs.
 * @param generator Yields the keys and current data of each item that should
 *   exist for the input. Keys must be unique.
 * @param factory Constructs an item, given a scope for the item's lifetime,
 *   a Behavior of its data, and its keys.
 */
export function keyedItems<
  Input,
  Keys extends [unknown, ...unknown[]],
  Data,
  Item,
>(
  scope: ObservableScope,
  name: string,
  input$: Behavior<Input>,
  generator: (
    input: Input,
  ) => Iterable<{ keys: readonly [...Keys]; data: Data }>,
  factory: (
    scope: ObservableScope,
    data$: Behavior<Data>,
    ...keys: Keys
  ) => Item,
): Behavior<Item[]> {
  // Entries live in a tree of Maps, one level per key
  let tree = new Map<unknown, unknown>();
  let entries = new Set<Entry<Data, Item>>();
  const items$ = state<Item[]>([]);

  scope.effect(() => {
    const input = input$.value;
    const nextTree = new Map<unknown, unknown>();
    const nextEntries = new Set<Entry<Data, Item>>();

    for (const { keys, data } of generator(input)) {
      let node: unknown = tree;
      for (const key of keys) node = (node as Map<unknown, unknown>)?.get(key);
      let entry = node as Entry<Data, Item> | undefined;

      if (entry === undefined) {
        logger.debug(`[${name}] Creating item with keys ${keys.join(", ")}`);
        const itemScope = new ObservableScope();
        const data$ = state(data);
        // What the factory reads is not a dependency of this collection
        const item = untracked(() => factory(itemScope, data$, ...keys));
        entry = { scope: itemScope, keys, data$, item };
      } else {
        entry.data$.value = data;
      }

      let parent = nextTree;
      for (const key of keys.slice(0, -1)) {
        let child = parent.get(key) as Map<unknown, unknown> | undefined;
        if (child === undefined) parent.set(key, (child = new Map()));
        parent = child;
      }
      const lastKey = keys[keys.length - 1];
      if (parent.has(lastKey))
        throw new Error(
          `[${name}] Keys must be unique (tried to generate multiple items for key ${keys.join(", ")})`,
        );
      parent.set(lastKey, entry);
      nextEntries.add(entry);
    }

    for (const entry of entries) if (!nextEntries.has(entry)) destroy(entry);

    tree = nextTree;
    entries = nextEntries;
    const items = [...entries].map(({ item }) => item);
    if (!shallowEquals(items$.peek(), items)) items$.value = items;
  });

  scope.onEnd(() => {
    logger.debug(
      `[${name}] End of scope, destroying all ${entries.size} items…`,
    );
    for (const entry of entries) destroy(entry);
  });

  function destroy(entry: Entry<Data, Item>): void {
    logger.debug(
      `[${name}] Destroying item with keys ${entry.keys.join(", ")}`,
    );
    entry.scope.end();
  }

  return items$;
}
