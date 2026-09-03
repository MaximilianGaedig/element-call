/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { of, throwError } from "rxjs";

import { computed, state } from "./Behavior";
import { ObservableScope } from "./ObservableScope";

describe("State", () => {
  it("notifies rxjs subscribers in order, with the latest value only", () => {
    const s$ = state(0);
    const first: number[] = [];
    const second: number[] = [];
    s$.subscribe((v) => {
      first.push(v);
      // Re-entrant write while the first subscriber is being notified
      if (v === 1) s$.value = 2;
    });
    s$.subscribe((v) => second.push(v));
    s$.value = 1;
    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual([0, 2]);
    expect(s$.value).toBe(2);
  });

  it("skips writes of the same value", () => {
    const s$ = state("a");
    const seen: string[] = [];
    s$.subscribe((v) => seen.push(v));
    s$.value = "a";
    expect(seen).toEqual(["a"]);
  });
});

describe("computed", () => {
  it("tracks States and bridges to rxjs", () => {
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
});

describe("scope.behavior", () => {
  it("produces a trackable Behavior", () => {
    const scope = new ObservableScope();
    const b$ = scope.behavior(of(3));
    expect(computed(() => b$.value * 2).value).toBe(6);
    scope.end();
  });

  it("propagates rxjs errors", () => {
    const scope = new ObservableScope();
    const error = new Error("boom");
    const b$ = scope.behavior(
      throwError(() => error),
      0,
    );
    expect(() => b$.value).toThrow(error);
    scope.end();
  });
});
