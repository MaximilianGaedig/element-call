/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useCallback, useMemo } from "react";
import classNames from "classnames";

import { type GridLayout as GridLayoutModel } from "../state/layout-types.ts";
import styles from "./GridLayout.module.css";
import { type CallLayout, arrangeTiles, fitRowHeight } from "./CallLayout";
import { type DragCallback, useUpdateLayout, useVisibleTiles } from "./Grid";
import { useBehavior } from "../useBehavior";
import { useReorderTiles } from "./reorder.ts";
import { droppedPosition, floatingClass, floatingStyle } from "./floating.ts";
import {
  TileGrid,
  cellCount,
  useEnlargedTiles,
  useVideoAspectRatios,
} from "./TileGrid";
import { relaxedGrid, useSetting } from "../settings/settings";

/**
 * An implementation of the "grid" layout, in which all participants are shown
 * together in a scrolling grid.
 */
export const makeGridLayout: CallLayout<GridLayoutModel> = ({
  minBounds$,
}) => ({
  foreground: "fixed",

  // The "fixed" (non-scrolling) part of the layout is where the spotlight tile
  // lives
  fixed: function GridLayoutFixed({ ref, model, Slot }): ReactNode {
    useUpdateLayout();
    const position = useBehavior(model.spotlightPosition$);

    const onDragSpotlight: DragCallback = useCallback(
      (drag) => {
        if (drag.final) model.spotlightPosition$.value = droppedPosition(drag);
      },
      [model.spotlightPosition$],
    );

    return (
      <div ref={ref} className={styles.fixed}>
        {model.spotlight && (
          <Slot
            className={classNames(styles.slot, floatingClass)}
            style={floatingStyle(position)}
            id="spotlight"
            model={model.spotlight}
            onDrag={onDragSpotlight}
          />
        )}
      </div>
    );
  },

  // The scrolling part of the layout is where all the grid tiles live
  scrolling: function GridLayout({ ref, model, Slot }): ReactNode {
    useUpdateLayout();
    useVisibleTiles(model.setVisibleTiles);
    const onDragTile = useReorderTiles(model);
    const { width, height: minHeight } = useBehavior(minBounds$);
    const enlarged = useEnlargedTiles(model.grid);
    const cells = cellCount(model.grid.length, enlarged);
    const { gap, tileWidth, tileHeight, columns } = useMemo(
      () => arrangeTiles(width, minHeight, cells),
      [width, minHeight, cells],
    );
    // Rows of one height, each tile as wide as its video's shape makes it,
    // rather than columns. Only the flexed grid can pack rows like that; the
    // cell grid used around enlarged tiles has fixed tracks.
    const [relaxed] = useSetting(relaxedGrid);
    const aspectRatios = useVideoAspectRatios(model.grid);
    const rows = useMemo(() => {
      if (!relaxed || enlarged.some(Boolean)) return null;
      const ratios = aspectRatios.map((ar) => ar || tileWidth / tileHeight);
      const height = fitRowHeight(width, minHeight, gap, ratios);
      return {
        height,
        widths: ratios.map((ar) => Math.min(height * ar, width - 2 * gap)),
      };
    }, [
      relaxed,
      enlarged,
      aspectRatios,
      width,
      minHeight,
      gap,
      tileWidth,
      tileHeight,
    ]);

    return (
      <TileGrid
        ref={ref}
        className={styles.scrolling}
        style={{ width }}
        grid={model.grid}
        enlarged={enlarged}
        gap={gap}
        tileWidth={tileWidth}
        tileHeight={rows?.height ?? tileHeight}
        widths={rows?.widths}
        columns={columns}
        Slot={Slot}
        onDrag={onDragTile}
      />
    );
  },
});
