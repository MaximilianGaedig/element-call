/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import { usedColumns } from "./CallLayout";

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
