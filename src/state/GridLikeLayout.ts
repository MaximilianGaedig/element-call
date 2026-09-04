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
import { type MediaViewModel } from "./media/MediaViewModel.ts";

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

export interface GridLikeLayoutInputs {
  spotlightPosition$: State<FloatingPosition>;
  railWidth$: State<number>;
  visibleTiles: number;
  setVisibleTiles: (value: number) => void;
  moveTile: MoveTile;
  move: GridMove | null;
}

/**
 * Produces a grid-like layout (any layout with a grid and possibly a spotlight)
 * with the given media.
 */
export function gridLikeLayout(
  media: LayoutMedia & { type: GridLikeLayoutType },
  {
    spotlightPosition$,
    railWidth$,
    visibleTiles,
    setVisibleTiles,
    moveTile,
    move,
  }: GridLikeLayoutInputs,
  prevTiles: TileStore,
): [Layout & { type: GridLikeLayoutType }, TileStore] {
  // Spotlit users don't also appear in the grid (except for the local user
  // when merely spotlit as the fallback speaker, so that they keep a tile).
  // The first of them (the speaker, or the first pinned user when there are
  // pins) swaps places in the grid with whoever was first before, so that a
  // change of spotlight doesn't shift the grid; the rest simply leave the
  // grid while they're spotlit.
  const spotlitUsers = (spotlight: MediaViewModel[]): UserMediaViewModel[] =>
    spotlight.filter(
      (vm): vm is UserMediaViewModel =>
        vm.type === "user" && (!vm.local || vm.pinned$.value),
    );
  const spotlit = spotlitUsers(media.spotlight ?? []);
  const prevSpotlit = spotlitUsers(prevTiles.spotlightMedia);
  const prevOrder =
    move === null
      ? prevTiles.gridMedia
      : moveMember(prevTiles.gridMedia, move.media, move.to);
  const grid = reconcileOrder(prevOrder, {
    members: media.grid.filter((m) => !spotlit.some((s) => s === m.media)),
    visibleTiles,
    entering: spotlit[0],
    leaving: prevSpotlit[0],
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
      railWidth$,
      setVisibleTiles,
      moveTile,
    } as Layout & { type: GridLikeLayoutType },
    tiles,
  ];
}
