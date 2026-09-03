/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sleep } from "matrix-js-sdk/lib/utils";

import { Scope } from "./Scope";
import { state } from "./Behavior";

describe("Reconcile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should wait clean up before processing next", async () => {
    vi.useFakeTimers();
    const scope = new Scope();
    const behavior$ = state<number>(0);

    const setup = vi.fn().mockImplementation(async () => await sleep(100));
    const cleanup = vi
      .fn()
      .mockImplementation(async (n: number) => await sleep(100));
    scope.reconcile(behavior$, async (value) => {
      await setup();
      return async (): Promise<void> => {
        await cleanup(value);
      };
    });
    // Let the initial setup process
    await vi.advanceTimersByTimeAsync(120);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(0);

    // Send next value
    behavior$.value = 1;
    await vi.advanceTimersByTimeAsync(50);
    // Should not have started setup for 1 yet
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(0);

    // Let cleanup finish
    await vi.advanceTimersByTimeAsync(50);
    // Now setup for 1 should have started
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it("should skip intermediates values that are not setup", async () => {
    vi.useFakeTimers();
    const scope = new Scope();
    const behavior$ = state<number>(0);

    const setup = vi
      .fn()
      .mockImplementation(async (n: number) => await sleep(100));

    const cleanupLock = Promise.withResolvers();
    const cleanup = vi
      .fn()
      .mockImplementation(async (n: number) => await cleanupLock.promise);

    scope.reconcile(behavior$, async (value) => {
      await setup(value);
      return async (): Promise<void> => {
        await cleanup(value);
      };
    });
    // Let the initial setup process (0)
    await vi.advanceTimersByTimeAsync(120);

    // Send 4 next values quickly
    behavior$.value = 1;
    behavior$.value = 2;
    behavior$.value = 3;
    behavior$.value = 4;

    await vi.advanceTimersByTimeAsync(3000);
    // should have only called cleanup for 0
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(0);
    // Let cleanup finish
    cleanupLock.resolve(undefined);
    await vi.advanceTimersByTimeAsync(120);

    // Now setup for 4 should have started, skipping 1,2,3
    expect(setup).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledWith(4);
    expect(setup).not.toHaveBeenCalledWith(1);
    expect(setup).not.toHaveBeenCalledWith(2);
    expect(setup).not.toHaveBeenCalledWith(3);
  });

  it("should wait for setup to complete before starting cleanup", async () => {
    vi.useFakeTimers();
    const scope = new Scope();
    const behavior$ = state<number>(0);

    const setup = vi
      .fn()
      .mockImplementation(async (n: number) => await sleep(3000));

    const cleanupLock = Promise.withResolvers();
    const cleanup = vi
      .fn()
      .mockImplementation(async (n: number) => await cleanupLock.promise);

    scope.reconcile(behavior$, async (value) => {
      await setup(value);
      return async (): Promise<void> => {
        await cleanup(value);
      };
    });

    await vi.advanceTimersByTimeAsync(500);
    // Setup for 0 should be in progress
    expect(setup).toHaveBeenCalledTimes(1);

    behavior$.value = 1;
    await vi.advanceTimersByTimeAsync(500);

    // Should not have started setup for 1 yet
    expect(setup).not.toHaveBeenCalledWith(1);
    // Should not have called cleanup yet, because the setup for 0 is not done
    expect(cleanup).toHaveBeenCalledTimes(0);

    // Let setup for 0 finish
    await vi.advanceTimersByTimeAsync(2500 + 100);
    // Now cleanup for 0 should have started
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(0);

    cleanupLock.resolve(undefined);
    await vi.advanceTimersByTimeAsync(100);
    // Now setup for 1 should have started
    expect(setup).toHaveBeenCalledWith(1);
  });
});
