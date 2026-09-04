/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "vitest";
import {
  type FloatingPosition,
  layoutShallowEquals,
  type Layout,
} from "./layout-types";
import {
  type SpotlightTileViewModel,
  type GridTileViewModel,
} from "./TileViewModel";
import { state } from "./Behavior";

const spotlightTile = {} as unknown as SpotlightTileViewModel;
const gridTile = {} as unknown as GridTileViewModel;
const pipPosition$ = state<FloatingPosition>({ x: 1, y: 1 });

const spotlightExpanded: Layout = {
  type: "spotlight-expanded",
  spotlight: spotlightTile,
  pipPosition$,
};

const spotlightPortrait: Layout = {
  type: "spotlight-portrait",
  spotlight: spotlightTile,
  grid: [gridTile],
  setVisibleTiles: () => {},
  moveTile: () => {},
};

test("layoutShallowEquals considers a layout to be equal to its shallow clone", () =>
  expect(layoutShallowEquals(spotlightExpanded, { ...spotlightExpanded })).toBe(
    true,
  ));

test("layoutShallowEquals detects a missing key", () => {
  expect(
    layoutShallowEquals(spotlightExpanded, {
      ...spotlightExpanded,
      pip: gridTile,
    }),
  ).toBe(false);
  expect(
    layoutShallowEquals(
      { ...spotlightExpanded, pip: gridTile },
      spotlightExpanded,
    ),
  ).toBe(false);
});

test("layoutShallowEquals considers grid arrays with equal contents to be equal", () =>
  expect(
    layoutShallowEquals(spotlightPortrait, {
      ...spotlightPortrait,
      grid: [...spotlightPortrait.grid],
    }),
  ).toBe(true));

test("layoutShallowEquals detects grid arrays with different contents", () =>
  expect(
    layoutShallowEquals(spotlightPortrait, {
      ...spotlightPortrait,
      grid: [...spotlightPortrait.grid, gridTile],
    }),
  ).toBe(false));
