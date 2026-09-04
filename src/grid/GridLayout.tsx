/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import classNames from "classnames";

import { type GridLayout as GridLayoutModel } from "../state/layout-types.ts";
import {
  type GridTileViewModel,
  type TileViewModel,
} from "../state/TileViewModel.ts";
import { computed } from "../state/Behavior.ts";
import styles from "./GridLayout.module.css";
import { type CallLayout, arrangeTiles, usedColumns } from "./CallLayout";
import { shallowEquals as shallowArrayEquals } from "../utils/array.ts";
import {
  type DragCallback,
  type LayoutProps,
  useUpdateLayout,
  useVisibleTiles,
} from "./Grid";
import { useBehavior } from "../useBehavior";
import { useReorderTiles } from "./reorder.ts";
import { droppedPosition, floatingClass, floatingStyle } from "./floating.ts";

interface GridCSSProperties extends CSSProperties {
  "--gap": string;
  "--width": string;
  "--height": string;
  "--columns": number;
  "--span": number;
}

interface GridSlotProps {
  Slot: LayoutProps<GridLayoutModel, TileViewModel, HTMLDivElement>["Slot"];
  tile: GridTileViewModel;
  onDrag: DragCallback;
}

// Each slot subscribes to its own tile's size so that enlarging one tile
// doesn't re-render the whole layout
const GridSlot: ComponentType<GridSlotProps> = ({ Slot, tile, onDrag }) => {
  const enlarged = useBehavior(tile.enlarged$);
  return (
    <Slot
      className={styles.slot}
      id={tile.id}
      model={tile}
      onDrag={onDrag}
      data-enlarged={enlarged || undefined}
    />
  );
};

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
    const enlarged = useBehavior(
      useMemo(
        () =>
          computed(
            () => model.grid.map((tile) => tile.enlarged$.value),
            shallowArrayEquals,
          ),
        [model.grid],
      ),
    );
    const enlargedCount = enlarged.filter(Boolean).length;
    // An enlarged tile spans 2×2 cells, so it takes 3 extra cells' worth of
    // space
    const cellCount = model.grid.length + 3 * enlargedCount;
    const { gap, tileWidth, tileHeight, columns } = useMemo(
      () => arrangeTiles(width, minHeight, cellCount),
      [width, minHeight, cellCount],
    );

    return (
      <div
        ref={ref}
        className={styles.scrolling}
        // With nothing enlarged, tiles are flexed so that a partial last row
        // is centred. Otherwise they're placed on a grid so that they can flow
        // around the enlarged ones.
        data-cells={enlargedCount > 0 || undefined}
        style={
          {
            width,
            "--gap": `${gap}px`,
            "--width": `${Math.floor(tileWidth)}px`,
            "--height": `${Math.floor(tileHeight)}px`,
            // Only as many columns as get filled, so the grid stays centred
            // when an enlarged tile wraps onto a row of its own
            "--columns": usedColumns(enlarged, columns),
            "--span": Math.min(2, columns),
          } as GridCSSProperties
        }
      >
        {model.grid.map((m) => (
          <GridSlot key={m.id} Slot={Slot} tile={m} onDrag={onDragTile(m)} />
        ))}
      </div>
    );
  },
});
