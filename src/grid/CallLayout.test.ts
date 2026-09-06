/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import { fitRowHeight, usedColumns } from "./CallLayout";

test("a grid with nothing enlarged uses all its columns", () => {
  expect(usedColumns([false, false, false], 3)).toBe(3);
  expect(usedColumns([false, false], 3)).toBe(2);
});

test("an enlarged tile that wraps onto its own row leaves a column unused", () => {
  // Two small tiles on the first row, then a 2×2 tile that only fits below
  // them: nothing ever reaches the third column
  expect(usedColumns([false, false, true], 3)).toBe(2);
});

test("small tiles flow around an enlarged tile", () => {
  // The big tile takes the first two columns of two rows; the small tiles
  // fill the third column beside it
  expect(usedColumns([true, false, false], 3)).toBe(3);
});

test("spans are capped by the column count", () => {
  expect(usedColumns([true, true], 1)).toBe(1);
});

test("nonsense column counts don't hang the layout", () => {
  expect(usedColumns([true, false], NaN)).toBe(1);
  expect(usedColumns([true, false], 0)).toBe(1);
  expect(usedColumns([false, false, false], 2.6)).toBe(2);
});

test("rows of one height fit their bounds", () => {
  // Four 16:9 tiles in a 1000x500 box with 20px gaps go two to a row, and
  // it's the height that limits them: 2h + 3 * 20 <= 500
  const wide = 16 / 9;
  expect(fitRowHeight(1000, 500, 20, [wide, wide, wide, wide])).toBeCloseTo(
    220,
    0,
  );
  // A lone portrait tile takes the full height
  expect(fitRowHeight(1000, 500, 20, [9 / 16])).toBeCloseTo(460, 0);
  // Three 16:9 tiles in a box with room for one row are limited by the
  // width instead: 3 * 16h/9 + 4 * 20 <= 1000
  expect(fitRowHeight(1000, 300, 20, [wide, wide, wide])).toBeCloseTo(172, 0);
});
