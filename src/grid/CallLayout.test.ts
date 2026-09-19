/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import { packRows, type Rect, usedColumns } from "./CallLayout";

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
  // Four 16:9 tiles in a 960x460 box with 20px gaps go two to a row, and
  // the rows' height is limited by the box: 2h + 20 <= 460
  const wide = 16 / 9;
  const rows = packRows({ width: 960, height: 460 }, 20, [
    wide,
    wide,
    wide,
    wide,
  ]);
  for (const r of rows) expect(r.height).toBeCloseTo(220, 0);
  expect(rows[0].y).toBeCloseTo(0, 0);
  expect(rows[2].y).toBeCloseTo(240, 0);
  // Three 16:9 tiles in a box with room for one row are limited by the
  // width instead: 3 * 16h/9 + 2 * 20 <= 960, and are centred
  const row = packRows({ width: 960, height: 260 }, 20, [wide, wide, wide]);
  expect(row[0].height).toBeCloseTo(172, 0);
  expect(row[0].x).toBeCloseTo(0, -1);
  expect(row[0].y).toBeCloseTo(44, 0);
});

test("a portrait tile spans two rows", () => {
  // A 9:16 tile beside two rows of two 16:9 tiles: the landscape tiles are
  // 220px tall as above and the portrait one 460px, with the second row of
  // landscape tiles flowing beneath the first, not beneath the portrait one
  const wide = 16 / 9;
  const [tall, a, , c] = packRows({ width: 1200, height: 460 }, 20, [
    9 / 16,
    wide,
    wide,
    wide,
    wide,
  ]);
  expect(tall.height).toBeCloseTo(460, -1);
  expect(tall.width).toBeCloseTo(259, -1);
  expect(a.height).toBeCloseTo(220, 0);
  expect(a.y).toBeCloseTo(0, 0);
  expect(c.y).toBeCloseTo(240, 0);
  expect(c.x).toBeCloseTo(a.x, 0);
  expect(a.x).toBeGreaterThan(tall.x + tall.width);
  // A tile that doesn't fit on the first row fills the space beside the
  // portrait tile's lower half rather than starting a fresh row after it
  const [, tall2, , below] = packRows({ width: 1000, height: 460 }, 20, [
    wide,
    9 / 16,
    wide,
    wide,
  ]);
  expect(below.y).toBeCloseTo(240, -1);
  expect(below.x).toBeLessThan(tall2.x);
  // A lone portrait tile doesn't get a slot taller than its width allows
  const [lone] = packRows({ width: 200, height: 1000 }, 20, [9 / 16]);
  expect(lone.width).toBeCloseTo(200, 0);
  expect(lone.height).toBeCloseTo(355, -1);
});

test("rows keep a minimum height and run past the bounds instead", () => {
  const wide = 16 / 9;
  const rows = packRows(
    { width: 400, height: 300 },
    20,
    [wide, wide, wide, wide],
    { minRowHeight: 150 },
  );
  for (const r of rows) expect(r.height).toBeCloseTo(150, 0);
  expect(rows[0].y).toBe(0);
  expect(rows[3].y).toBeCloseTo(510, 0);
});

test("an enlarged tile spans twice the rows", () => {
  const wide = 16 / 9;
  const [big, small] = packRows(
    { width: 2000, height: 460 },
    20,
    [wide, wide],
    { enlarged: [true, false] },
  );
  expect(big.height).toBeCloseTo(460, -1);
  expect(small.height).toBeCloseTo(220, -1);
  expect(small.x).toBeGreaterThan(big.x + big.width);
});

test("nonsense shapes and bounds don't hang the packer", () => {
  expect(
    packRows({ width: 800, height: 600 }, 20, [16 / 9], { minRowHeight: NaN }),
  ).toHaveLength(1);
  expect(packRows({ width: 800, height: 600 }, NaN, [9 / 16])).toHaveLength(1);
  expect(
    packRows({ width: 0, height: 0 }, 20, [NaN, 0, Infinity]),
  ).toHaveLength(3);
  expect(
    packRows({ width: NaN, height: NaN }, 20, [16 / 9], {
      minRowHeight: 100,
    }),
  ).toHaveLength(1);
});

test("portrait tiles can be kept to one row", () => {
  const [tall, wide] = packRows(
    { width: 1000, height: 500 },
    20,
    [9 / 16, 16 / 9],
    {
      tallPortraits: false,
    },
  );
  expect(tall.height).toBeCloseTo(wide.height, -1);
});

test("packed tiles never overlap", () => {
  // A crude fuzz: a fixed sequence of mixed shapes, enlargements and bounds.
  // Row heights are bisected to within half a pixel, so allow that much
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5;
  // Park-Miller's minimal standard generator, so the sequence is fixed
  let seed = 1;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(rnd() * 12);
    const ratios = Array.from({ length: n }, () =>
      rnd() < 0.5 ? 9 / 16 : 16 / 9,
    );
    const rects = packRows(
      { width: 200 + rnd() * 1500, height: 200 + rnd() * 1000 },
      20,
      ratios,
      {
        enlarged: ratios.map(() => rnd() < 0.2),
        minRowHeight: rnd() < 0.5 ? rnd() * 300 : 0,
        tallPortraits: rnd() < 0.5,
      },
    );
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        expect(overlaps(rects[i], rects[j]), `${t}: ${i} and ${j}`).toBe(false);
  }
});
