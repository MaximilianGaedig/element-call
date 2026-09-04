/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type Alignment,
  type Layout,
  type LayoutMedia,
} from "./layout-types.ts";
import { type TileStore } from "./TileStore";
import { type State } from "./Behavior";
import { reconcileOrder } from "./gridOrder.ts";

export type GridLikeLayoutType =
  | "grid"
  | "spotlight-landscape"
  | "spotlight-portrait";

/**
 * Produces a grid-like layout (any layout with a grid and possibly a spotlight)
 * with the given media.
 */
export function gridLikeLayout(
  media: LayoutMedia & { type: GridLikeLayoutType },
  spotlightAlignment$: State<Alignment>,
  visibleTiles: number,
  setVisibleTiles: (value: number) => void,
  prevTiles: TileStore,
): [Layout & { type: GridLikeLayoutType }, TileStore] {
  // Spotlit users don't also appear in the grid (except for the local user)
  const spotlit = (media.spotlight ?? []).find(
    (vm) => vm.type === "user" && !vm.local,
  );
  const prevSpotlit = prevTiles.spotlightMedia.find(
    (vm) => vm.type === "user" && !vm.local,
  );
  const grid = reconcileOrder(prevTiles.gridMedia, {
    members: media.grid.filter((m) => m.media !== spotlit),
    visibleTiles,
    entering: spotlit,
    leaving: prevSpotlit,
  });

  const update = prevTiles.from();
  if (media.spotlight !== undefined)
    update.registerSpotlight(
      media.spotlight,
      media.type === "spotlight-portrait",
    );
  for (const mediaVm of grid) update.registerGridTile(mediaVm);
  const tiles = update.build();

  return [
    {
      type: media.type,
      spotlight: tiles.spotlightTile,
      grid: tiles.gridTiles,
      spotlightAlignment$,
      setVisibleTiles,
    } as Layout & { type: GridLikeLayoutType },
    tiles,
  ];
}
