/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ComponentType } from "react";

import { type LayoutProps } from "./Grid";
import { type TileViewModel } from "../state/TileViewModel";
import { type Behavior } from "../state/Behavior";

export interface Bounds {
  width: number;
  height: number;
}

export interface CallLayoutInputs {
  /**
   * The minimum bounds of the layout area.
   */
  minBounds$: Behavior<Bounds>;
}

export interface CallLayoutOutputs<Model> {
  /**
   * Which layer should appear in the foreground.
   */
  foreground: "fixed" | "scrolling";
  /**
   * The visually fixed (non-scrolling) layer of the layout.
   */
  fixed: ComponentType<LayoutProps<Model, TileViewModel, HTMLDivElement>>;
  /**
   * The layer of the layout that can overflow and be scrolled.
   */
  scrolling: ComponentType<LayoutProps<Model, TileViewModel, HTMLDivElement>>;
}

/**
 * A layout system for media tiles.
 */
export type CallLayout<Model> = (
  inputs: CallLayoutInputs,
) => CallLayoutOutputs<Model>;

export interface GridArrangement {
  tileWidth: number;
  tileHeight: number;
  gap: number;
  columns: number;
}

/**
 * Works out how many columns a dense CSS grid actually fills when the given
 * tiles are placed into it in order, enlarged ones spanning 2×2 cells. The
 * grid centres its tracks, not its content, so a grid sized to more columns
 * than get used would sit off-centre; this lets the layout size it right.
 *
 * This mirrors the browser's dense auto-placement: each tile goes in the
 * first free spot, scanning row by row, that it fits in.
 */
export function usedColumns(
  enlarged: readonly boolean[],
  columns: number,
): number {
  // arrangeTiles can produce fractional columns, or NaN before the layout
  // has a size; the scan below needs a whole number of at least 1 or it
  // would never find a fit
  if (!(columns >= 1)) return 1;
  columns = Math.floor(columns);
  const span = Math.min(2, columns);
  const rows: boolean[][] = [];
  const free = (r: number, c: number): boolean => !rows[r]?.[c];
  let used = 0;
  for (const big of enlarged) {
    const [w, h] = big ? [span, 2] : [1, 1];
    let r = 0;
    let c = 0;
    // Find the first spot where every cell the tile needs is free
    for (;;) {
      let fits = c + w <= columns;
      for (let i = 0; fits && i < h; i++)
        for (let j = 0; fits && j < w; j++) fits = free(r + i, c + j);
      if (fits) break;
      if (++c + w > columns) {
        c = 0;
        r++;
      }
    }
    for (let i = 0; i < h; i++) {
      rows[r + i] ??= [];
      for (let j = 0; j < w; j++) rows[r + i][c + j] = true;
    }
    used = Math.max(used, c + w);
  }
  return Math.max(1, used);
}

const tileMaxAspectRatio = 17 / 9;
const tileMinAspectRatio = 4 / 3;

/**
 * Determine the ideal arrangement of tiles into a grid of a particular size.
 */
export function arrangeTiles(
  width: number,
  minHeight: number,
  tileCount: number,
): GridArrangement {
  // The goal here is to determine the grid size and padding that maximizes
  // use of screen space for n tiles without making those tiles too small or
  // too cropped (having an extreme aspect ratio)
  const gap = width < 800 ? 16 : 20;
  const area = width * minHeight;
  // Magic numbers that make tiles scale up nicely as the window gets larger
  const tileArea = Math.pow(Math.sqrt(area) / 8 + 125, 2);
  const tilesPerPage = Math.min(tileCount, area / tileArea);

  let columns = Math.min(
    // Don't create more columns than we have items for
    tilesPerPage,
    // The ideal number of columns is given by a packing of equally-sized
    // squares into a grid.
    // width / column = height / row.
    // columns * rows = number of squares.
    // ∴ columns = sqrt(width / height * number of squares).
    // Except we actually want 16:9-ish tiles rather than squares, so we
    // divide the width-to-height ratio by the target aspect ratio.
    Math.round(
      Math.sqrt((width / minHeight / tileMinAspectRatio) * tilesPerPage),
    ),
  );
  let rows = tilesPerPage / columns;
  // If all the tiles could fit on one page, we want to ensure that they do by
  // not leaving fractional rows hanging off the bottom
  if (tilesPerPage === tileCount) {
    rows = Math.ceil(rows);
    // We may now be able to fit the tiles into fewer columns
    columns = Math.ceil(tileCount / rows);
  }

  let tileWidth = (width - (columns + 1) * gap) / columns;
  let tileHeight = (minHeight - (rows - 1) * gap) / rows;

  // Impose a minimum and maximum aspect ratio on the tiles
  const tileAspectRatio = tileWidth / tileHeight;
  if (tileAspectRatio > tileMaxAspectRatio)
    tileWidth = tileHeight * tileMaxAspectRatio;
  else if (tileAspectRatio < tileMinAspectRatio)
    tileHeight = tileWidth / tileMinAspectRatio;

  return { tileWidth, tileHeight, gap, columns };
}

/**
 * For rows of tiles that all share one height while their widths follow
 * their videos' shapes (see the relaxedGrid setting): the tallest height at
 * which the tiles, packed into rows in order with the given gap, still fit
 * the bounds. Tiles are packed the way a wrapping flex row packs them, so
 * the result matches what the browser lays out.
 */
export function fitRowHeight(
  width: number,
  minHeight: number,
  gap: number,
  aspectRatios: readonly number[],
): number {
  const maxWidth = width - 2 * gap;
  const rowsAt = (h: number): number => {
    let rows = 1;
    let x = gap;
    for (const ar of aspectRatios) {
      const w = Math.min(h * ar, maxWidth);
      if (x > gap && x + w + gap > width) {
        rows++;
        x = gap;
      }
      x += w + gap;
    }
    return rows;
  };
  const fits = (h: number): boolean => {
    const rows = rowsAt(h);
    return rows * h + (rows + 1) * gap <= minHeight;
  };
  // ponytail: bisection to the pixel, fine for a few dozen tiles
  let lo = 0;
  let hi = minHeight - 2 * gap;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
