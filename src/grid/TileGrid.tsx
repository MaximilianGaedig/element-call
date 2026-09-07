/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type ComponentType,
  type FC,
  type Ref,
  useMemo,
} from "react";
import classNames from "classnames";

import {
  type GridTileViewModel,
  type TileViewModel,
} from "../state/TileViewModel.ts";
import { computed } from "../state/Behavior.ts";
import { type MediaViewModel } from "../state/media/MediaViewModel.ts";
import { shallowEquals as shallowArrayEquals } from "../utils/array.ts";
import { type DragCallback, type SlotProps } from "./Grid";
import { type Rect, usedColumns } from "./CallLayout";
import { useBehavior } from "../useBehavior";
import styles from "./TileGrid.module.css";

interface GridCSSProperties extends CSSProperties {
  "--gap": string;
  "--width": string;
  "--height": string;
  "--columns": number;
  "--span": number;
}

/**
 * Tracks which of the given tiles are enlarged, as one array so that the
 * layout only re-renders when the set of enlarged tiles changes.
 */
export function useEnlargedTiles(grid: GridTileViewModel[]): boolean[] {
  return useBehavior(
    useMemo(
      () =>
        computed(
          () => grid.map((tile) => tile.enlarged$.value),
          shallowArrayEquals,
        ),
      [grid],
    ),
  );
}

/**
 * Tracks the shape of each tile (see videoAspectRatio) as one array, so that
 * the layout only re-renders when a shape changes.
 */
export function useVideoAspectRatios(grid: GridTileViewModel[]): number[] {
  return useBehavior(
    useMemo(
      () =>
        computed(
          () => grid.map((tile) => videoAspectRatio(tile.media$.value)),
          shallowArrayEquals,
        ),
      [grid],
    ),
  );
}

/**
 * The shape of a user's tile: the aspect ratio of their video, or 16:9 (the
 * common case) until it has shown its shape or while they have none, so that
 * tiles are laid out right from the outset rather than animating into shape
 * once the video arrives. 0 for other media, which aren't shaped this way.
 */
export function videoAspectRatio(media: MediaViewModel): number {
  if (media.type !== "user") return 0;
  const ratio = media.videoAspectRatio$.value;
  return ratio > 0 ? ratio : 16 / 9;
}

/**
 * How many cells the given tiles take up, an enlarged tile spanning 2×2 cells
 * and so taking 3 extra cells' worth of space.
 */
export function cellCount(
  tileCount: number,
  enlarged: readonly boolean[],
): number {
  return tileCount + 3 * enlarged.filter(Boolean).length;
}

/** Positions an element absolutely at the rect, to whole pixels. */
// Floored so that a row's sizes, which the layout fitted exactly to the
// grid, can't round up past it and wrap the row's last tile
export const rectStyle = (r: Rect): CSSProperties => ({
  left: Math.floor(r.x),
  top: Math.floor(r.y),
  width: Math.floor(r.width),
  height: Math.floor(r.height),
});

interface TileSlotProps {
  Slot: ComponentType<SlotProps<TileViewModel>>;
  tile: GridTileViewModel;
  onDrag: DragCallback;
  /** A place of the layout's own choosing, overriding the grid's. */
  rect: Rect | undefined;
}

// Each slot subscribes to its own tile's size so that enlarging one tile
// doesn't re-render the whole grid
const TileSlot: FC<TileSlotProps> = ({ Slot, tile, onDrag, rect }) => {
  const enlarged = useBehavior(tile.enlarged$);
  return (
    <Slot
      className={styles.slot}
      id={tile.id}
      model={tile}
      onDrag={onDrag}
      data-enlarged={enlarged || undefined}
      style={rect && rectStyle(rect)}
    />
  );
};

interface Props {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  grid: GridTileViewModel[];
  /** Which tiles are enlarged, from useEnlargedTiles. */
  enlarged: readonly boolean[];
  gap: number;
  tileWidth: number;
  tileHeight: number;
  /** The most columns the grid may have. */
  columns: number;
  /**
   * A place for each tile, when they aren't to be arranged on a grid of
   * tileWidth by tileHeight cells (see packRows).
   */
  rects?: readonly Rect[];
  Slot: ComponentType<SlotProps<TileViewModel>>;
  onDrag: (tile: GridTileViewModel) => DragCallback;
}

/**
 * A grid of equally sized tile slots, some of which may be enlarged to span
 * 2×2 cells. This is the grid layout's grid, and also the spotlight's rail.
 */
export const TileGrid: FC<Props> = ({
  ref,
  className,
  style,
  grid,
  enlarged,
  gap,
  tileWidth,
  tileHeight,
  columns,
  rects,
  Slot,
  onDrag,
}) => {
  const enlargedCount = enlarged.filter(Boolean).length;
  return (
    <div
      ref={ref}
      className={classNames(className, styles.grid)}
      // With nothing enlarged, tiles are flexed so that a partial last row is
      // centred. Otherwise they're placed on a grid so that they can flow
      // around the enlarged ones.
      data-cells={enlargedCount > 0 || undefined}
      data-packed={rects !== undefined || undefined}
      style={
        {
          ...style,
          "--gap": `${gap}px`,
          "--width": `${Math.floor(tileWidth)}px`,
          "--height": `${Math.floor(tileHeight)}px`,
          // Only as many columns as get filled, so the grid stays centred
          // when an enlarged tile wraps onto a row of its own
          "--columns":
            enlargedCount > 0 ? usedColumns(enlarged, columns) : columns,
          "--span": Math.min(2, columns),
        } as GridCSSProperties
      }
    >
      {grid.map((m, i) => (
        <TileSlot
          key={m.id}
          Slot={Slot}
          tile={m}
          onDrag={onDrag(m)}
          rect={rects?.[i]}
        />
      ))}
    </div>
  );
};
