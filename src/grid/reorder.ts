/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useCallback } from "react";

import { type GridTileViewModel } from "../state/TileViewModel.ts";
import { type MoveTile } from "../state/layout-types.ts";
import { type DragCallback } from "./Grid.tsx";

interface ReorderableLayout {
  grid: GridTileViewModel[];
  moveTile: MoveTile;
}

/**
 * Makes drag callbacks for the tiles of a grid, so that dragging a tile over
 * another moves it to that tile's spot. This happens as soon as the dragged
 * tile crosses into another's slot, so the grid reflows around it as it's
 * dragged and its own slot is free for it to be dropped into.
 */
export function useReorderTiles({
  grid,
  moveTile,
}: ReorderableLayout): (tile: GridTileViewModel) => DragCallback {
  return useCallback(
    (tile) =>
      ({ over }) => {
        const to = grid.find((t) => t.id === over);
        if (to !== undefined) moveTile(tile, to);
      },
    [grid, moveTile],
  );
}
