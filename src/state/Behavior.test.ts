/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import EventEmitter from "events";
import { describe, expect, it } from "vitest";

import { computed, fromEvents, state } from "./Behavior";
import { Scope } from "./Scope";

describe("computed", () => {
  it("tracks States", () => {
    const a$ = state(1);
    const b$ = state(10);
    const sum$ = computed(() => a$.value + b$.value);
    const seen: number[] = [];
    sum$.subscribe((v) => seen.push(v));
    a$.value = 2;
    b$.value = 20;
    expect(sum$.value).toBe(22);
    expect(seen).toEqual([11, 12, 22]);
  });

  it("drops results that are equal to the previous one", () => {
    const list$ = state([1, 2]);
    const sorted$ = computed(
      () => [...list$.value].sort((a, b) => a - b),
      (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
    );
    const seen: number[][] = [];
    sorted$.subscribe((v) => seen.push(v));
    list$.value = [2, 1];
    list$.value = [3, 1];
    expect(seen).toEqual([
      [1, 2],
      [1, 3],
    ]);
  });
});

describe("fromEvents", () => {
  it("re-reads the value on each event until the scope ends", () => {
    const scope = new Scope();
    const emitter = Object.assign(new EventEmitter(), { count: 0 });
    const count$ = fromEvents(scope, emitter, ["tick"], (e) => e.count);
    expect(count$.value).toBe(0);
    emitter.count = 1;
    emitter.emit("tick");
    expect(count$.value).toBe(1);
    scope.end();
    emitter.count = 2;
    emitter.emit("tick");
    expect(count$.value).toBe(1);
    expect(emitter.listenerCount("tick")).toBe(0);
  });

  it("follows a Behavior of emitters", () => {
    const scope = new Scope();
    const a = Object.assign(new EventEmitter(), { name: "a" });
    const b = Object.assign(new EventEmitter(), { name: "b" });
    const emitter$ = state<typeof a | null>(a);
    const name$ = fromEvents(scope, emitter$, ["rename"], (e) => e?.name);
    expect(name$.value).toBe("a");
    emitter$.value = b;
    expect(name$.value).toBe("b");
    expect(a.listenerCount("rename")).toBe(0);
    b.name = "bb";
    b.emit("rename");
    expect(name$.value).toBe("bb");
    emitter$.value = null;
    expect(name$.value).toBeUndefined();
    scope.end();
  });
});

describe("Scope", () => {
  it("runs end callbacks once, in order, and immediately once ended", () => {
    const scope = new Scope();
    const order: string[] = [];
    scope.onEnd(() => order.push("first"));
    scope.onEnd(() => order.push("second"));
    scope.end();
    scope.end();
    scope.onEnd(() => order.push("late"));
    expect(order).toEqual(["first", "second", "late"]);
  });

  it("disposes effects when it ends", () => {
    const scope = new Scope();
    const s$ = state(0);
    const seen: number[] = [];
    scope.effect(() => {
      seen.push(s$.value);
    });
    s$.value = 1;
    scope.end();
    s$.value = 2;
    expect(seen).toEqual([0, 1]);
  });
});
