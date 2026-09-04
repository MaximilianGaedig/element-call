/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import { droppedPosition } from "./floating.ts";

const drop = (xRatio: number, yRatio: number): { x: number; y: number } =>
  droppedPosition({ x: 0, y: 0, xRatio, yRatio, over: undefined });

test("tiles dropped near an edge snap to it", () => {
  expect(drop(0.05, 0.97)).toEqual({ x: 0, y: 1 });
});

test("tiles dropped elsewhere stay put", () => {
  expect(drop(0.3, 0.6)).toEqual({ x: 0.3, y: 0.6 });
});

test("tiles dragged off the page are pulled back in", () => {
  expect(drop(-0.4, 1.7)).toEqual({ x: 0, y: 1 });
  expect(drop(NaN, NaN)).toEqual({ x: 0, y: 0 });
});
