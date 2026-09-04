/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type FloatingPosition,
  type Layout,
  type LayoutMedia,
  type MoveTile,
} from "./layout-types.ts";
import { type TileStore } from "./TileStore";
import { type State } from "./Behavior";
import { moveMember, reconcileOrder } from "./gridOrder.ts";
import { type UserMediaViewModel } from "./media/UserMediaViewModel.ts";

/**
 * A request from the user to move one grid tile's media onto another's spot.
 */
export interface GridMove {
  media: UserMediaViewModel;
  to: UserMediaViewModel;
}

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
  spotlightPosition$: State<FloatingPosition>,
  visibleTiles: number,
  setVisibleTiles: (value: number) => void,
  moveTile: MoveTile,
  move: GridMove | null,
  prevTiles: TileStore,
): [Layout & { type: GridLikeLayoutType }, TileStore] {
  // Spotlit users don't also appear in the grid (except for the local user)
  const spotlit = (media.spotlight ?? []).find(
    (vm) => vm.type === "user" && !vm.local,
  );
  const prevSpotlit = prevTiles.spotlightMedia.find(
    (vm) => vm.type === "user" && !vm.local,
  );
  const prevOrder =
    move === null
      ? prevTiles.gridMedia
      : moveMember(prevTiles.gridMedia, move.media, move.to);
  const grid = reconcileOrder(prevOrder, {
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
      spotlightPosition$,
      setVisibleTiles,
      moveTile,
    } as Layout & { type: GridLikeLayoutType },
    tiles,
  ];
}
