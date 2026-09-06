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
import { shallowEquals as shallowArrayEquals } from "../utils/array.ts";
import { type DragCallback, type SlotProps, useUpdateLayout } from "./Grid";
import { usedColumns } from "./CallLayout";
import { useBehavior } from "../useBehavior";
import { relaxedGrid, useSetting } from "../settings/settings";
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
 * How many cells the given tiles take up, an enlarged tile spanning 2×2 cells
 * and so taking 3 extra cells' worth of space.
 */
export function cellCount(
  tileCount: number,
  enlarged: readonly boolean[],
): number {
  return tileCount + 3 * enlarged.filter(Boolean).length;
}

interface TileSlotProps {
  Slot: ComponentType<SlotProps<TileViewModel>>;
  tile: GridTileViewModel;
  onDrag: DragCallback;
  /** Whether the slot should be as narrow as its video (see relaxedGrid). */
  relaxed: boolean;
}

// Each slot subscribes to its own tile's size so that enlarging one tile
// doesn't re-render the whole grid
const TileSlot: FC<TileSlotProps> = ({ Slot, tile, onDrag, relaxed }) => {
  useUpdateLayout();
  const enlarged = useBehavior(tile.enlarged$);
  const aspectRatio = useBehavior(
    useMemo(
      () =>
        computed(() => {
          const media = tile.media$.value;
          return media.type === "user" && media.videoEnabled$.value
            ? media.videoAspectRatio$.value
            : NaN;
        }),
      [tile],
    ),
  );
  return (
    <Slot
      className={styles.slot}
      id={tile.id}
      model={tile}
      onDrag={onDrag}
      data-enlarged={enlarged || undefined}
      // The flex row then packs and centres the hugged tiles itself
      style={
        relaxed && aspectRatio > 0
          ? { width: `min(var(--width), calc(var(--height) * ${aspectRatio}))` }
          : undefined
      }
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
  Slot,
  onDrag,
}) => {
  const enlargedCount = enlarged.filter(Boolean).length;
  const [relaxed] = useSetting(relaxedGrid);
  return (
    <div
      ref={ref}
      className={classNames(className, styles.grid)}
      // With nothing enlarged, tiles are flexed so that a partial last row is
      // centred. Otherwise they're placed on a grid so that they can flow
      // around the enlarged ones.
      data-cells={enlargedCount > 0 || undefined}
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
      {grid.map((m) => (
        <TileSlot
          key={m.id}
          Slot={Slot}
          tile={m}
          onDrag={onDrag(m)}
          // Only the flexed grid can pack rows; the cell grid has fixed tracks
          relaxed={relaxed && enlargedCount === 0}
        />
      ))}
    </div>
  );
};
