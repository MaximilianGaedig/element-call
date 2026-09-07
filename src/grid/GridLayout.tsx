/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useCallback, useMemo } from "react";
import classNames from "classnames";

import { type GridLayout as GridLayoutModel } from "../state/layout-types.ts";
import styles from "./GridLayout.module.css";
import { type CallLayout, arrangeTiles, packRows } from "./CallLayout";
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
import { hugVideo, relaxedGrid, useSetting } from "../settings/settings";

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
    const arrangement = useMemo(
      () => arrangeTiles(width, minHeight, cells),
      [width, minHeight, cells],
    );
    const { gap, columns, minTileHeight } = arrangement;
    const [hug] = useSetting(hugVideo);
    const aspectRatios = useVideoAspectRatios(model.grid);
    // Hugged tiles are no bigger than their videos make them, so shrink the
    // cells to the widest and tallest of them; a grid of same-shaped videos
    // then has even gaps rather than slack inside each cell
    const { tileWidth, tileHeight } = useMemo(() => {
      const known = aspectRatios.filter((ar) => ar > 0);
      if (!hug || known.length === 0) return arrangement;
      const tileHeight = Math.min(
        arrangement.tileHeight,
        Math.max(...known.map((ar) => arrangement.tileWidth / ar)),
      );
      const tileWidth = Math.min(
        arrangement.tileWidth,
        Math.max(...known.map((ar) => tileHeight * ar)),
      );
      return { tileWidth, tileHeight };
    }, [hug, aspectRatios, arrangement]);
    // Rows of one height, each tile as wide as its video's shape makes it,
    // rather than columns; enlarged tiles take two rows
    const [relaxed] = useSetting(relaxedGrid);
    const rows = useMemo(() => {
      if (!hug || !relaxed) return null;
      const ratios = aspectRatios.map((ar) => ar || tileWidth / tileHeight);
      // The grid keeps a gap's padding on every side. Rows shrink until the
      // tiles fit the page, but no further than the cells would have got
      // (which is how small the grid lets tiles get before it pages), and
      // scroll from there
      return packRows(
        { width: width - 2 * gap, height: minHeight - 2 * gap },
        gap,
        ratios,
        { minRowHeight: Math.min(tileHeight, minTileHeight), enlarged },
      ).map((r) => ({ ...r, x: r.x + gap, y: r.y + gap }));
    }, [
      hug,
      relaxed,
      enlarged,
      aspectRatios,
      width,
      minHeight,
      gap,
      tileWidth,
      tileHeight,
      minTileHeight,
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
        tileHeight={tileHeight}
        rects={rows ?? undefined}
        columns={columns}
        Slot={Slot}
        onDrag={onDragTile}
      />
    );
  },
});
