/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import { droppedPosition } from "./floating.ts";

// A 1000×500 container holding a 100×50 tile
const drop = (
  containerX: number,
  containerY: number,
): { x: number; y: number } =>
  droppedPosition({
    x: 0,
    y: 0,
    containerX,
    containerY,
    container: { width: 1000, height: 500 },
    tile: { width: 100, height: 50 },
    over: undefined,
    final: true,
  });

test("tiles dropped within the margin of an edge snap to it", () => {
  expect(drop(10, 440)).toEqual({ x: 0, y: Infinity });
});

test("tiles dropped elsewhere stay exactly put", () => {
  expect(drop(300, 123.4)).toEqual({ x: 300, y: 123.4 });
});

test("tiles dragged off the page are pulled back in", () => {
  expect(drop(-400, 700)).toEqual({ x: 0, y: Infinity });
  expect(drop(NaN, NaN)).toEqual({ x: 0, y: 0 });
});
