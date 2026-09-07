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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Packs tiles of the given aspect ratios into rows of one height, each tile
 * as wide as its shape makes it, at the largest row height at which they all
 * fit within the bounds (which have gaps only between tiles). Portrait tiles
 * span two rows so that they get about the area of a landscape one rather
 * than being squeezed to a single row's height, and enlarged tiles span
 * twice as many rows as they otherwise would. Rows are centred, unless
 * they run past the bounds: rows are never shorter than minRowHeight, so a
 * scrolling layout can keep its tiles a usable size.
 */
export function packRows(
  bounds: { width: number; height: number },
  gap: number,
  ratios: readonly number[],
  {
    minRowHeight = 0,
    enlarged = [] as readonly boolean[],
    tallPortraits = true,
  } = {},
): Rect[] {
  // A layout without bounds yet may pass NaN for any of these, or substitute
  // 0/0 for an unknown shape; a NaN width never fits anywhere, so placement
  // would loop for ever
  const finite = (n: number): number => (n > 0 && n < Infinity ? n : 0);
  const width = finite(bounds.width);
  const height = finite(bounds.height);
  gap = finite(gap);
  minRowHeight = finite(minRowHeight);
  const aspectRatios = ratios.map((ar) => (ar > 0 && ar < Infinity ? ar : 1));
  const spans = aspectRatios.map(
    (ar, i) => (tallPortraits && ar < 1 ? 2 : 1) * (enlarged[i] ? 2 : 1),
  );
  // Placement at a given row height: each tile goes in the first row, and
  // then the leftmost spot, where it fits, so that the gaps beside a portrait
  // tile in its second row are filled by the tiles after it
  const place = (h: number): { rects: Rect[]; rows: number[] } => {
    const taken: [number, number][][] = []; // Each row's occupied spans
    const rows: number[] = [];
    const rects = aspectRatios.map((ar, i) => {
      const span = spans[i];
      const tileHeight = span * h + (span - 1) * gap;
      const tileWidth = Math.min(finite(tileHeight * ar), width);
      const free = (row: number, x: number): boolean =>
        taken
          .slice(row, row + span)
          .every((t) =>
            t.every(([x0, x1]) => x + tileWidth + gap <= x0 || x >= x1 + gap),
          );
      for (let row = 0; ; row++) {
        const candidates = [
          0,
          ...taken
            .slice(row, row + span)
            .flatMap((t) => t.map(([, x1]) => x1 + gap)),
        ].sort((a, b) => a - b);
        const x = candidates.find(
          (x) => x + tileWidth <= width && free(row, x),
        );
        if (x === undefined) continue;
        for (let r = row; r < row + span; r++)
          (taken[r] ??= []).push([x, x + tileWidth]);
        rows.push(row);
        return { x, y: row * (h + gap), width: tileWidth, height: tileHeight };
      }
    });
    return { rects, rows };
  };
  const extent = (rects: Rect[]): number =>
    Math.max(0, ...rects.map((r) => r.y + r.height));
  // No taller than any tile needs at the full width, so that a lone tile
  // doesn't get a slot the height of the page
  const cap = Math.min(
    ...aspectRatios.map(
      (ar, i) => (width / ar - (spans[i] - 1) * gap) / spans[i],
    ),
  );
  // ponytail: bisection to the pixel, fine for a few dozen tiles
  let lo = 0;
  let hi = Math.min(height, cap);
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (extent(place(mid).rects) <= height) lo = mid;
    else hi = mid;
  }
  const { rects, rows } = place(
    finite(Math.min(cap, Math.max(lo, minRowHeight))),
  );
  // Centre the block vertically, and each row horizontally: rows that a
  // portrait tile ties together are centred as one
  const dy = Math.max(0, (height - extent(rects)) / 2);
  const tied: boolean[] = [];
  rects.forEach((_r, i) => {
    if (spans[i] === 2) tied[rows[i]] = true;
  });
  const rowCount = Math.max(0, ...rows) + 1;
  for (let start = 0; start < rowCount;) {
    let end = start;
    while (tied[end]) end++;
    const band = rects.filter((_r, i) => rows[i] >= start && rows[i] <= end);
    const dx = (width - Math.max(0, ...band.map((r) => r.x + r.width))) / 2;
    for (const r of band) {
      r.x += dx;
      r.y += dy;
    }
    start = end + 1;
  }
  return rects;
}
