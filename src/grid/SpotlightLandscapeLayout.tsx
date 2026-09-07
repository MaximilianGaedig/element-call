/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type FC,
  type ReactNode,
  useMemo,
  useRef,
} from "react";
import classNames from "classnames";
import { Resizable } from "re-resizable";

import { type CallLayout, packRows } from "./CallLayout";
import { type SpotlightLandscapeLayout as SpotlightLandscapeLayoutModel } from "../state/layout-types.ts";
import styles from "./SpotlightLandscapeLayout.module.css";
import { useUpdateLayout, useVisibleTiles } from "./Grid";
import { type MediaViewModel } from "../state/media/MediaViewModel.ts";
import { type Behavior } from "../state/Behavior.ts";
import { useBehavior } from "../useBehavior.ts";
import { useReorderTiles } from "./reorder.ts";
import {
  TileGrid,
  cellCount,
  useEnlargedTiles,
  useVideoAspectRatios,
} from "./TileGrid";
import { hugVideo, relaxedGrid, useSetting } from "../settings/settings";

interface LayerCSSProperties extends CSSProperties {
  "--rail-width": string;
}

interface RailArrangement {
  columns: number;
  tileWidth: number;
  tileHeight: number;
}

// The rail's fixed width before it became resizable, so nothing gets
// narrower than it was
const minRailWidth = 180;
const railGap = 20; // Must match --gap in the CSS

/**
 * Sizes the rail's tiles to fill as many columns as fit its width. The tiles
 * wrap in reading order, so widening the rail turns one column of a, b, c…
 * into rows of a, b, c / d, e, f / …
 */
const arrangeRail = (
  railWidth: number,
  tileCount: number,
  railHeight: number,
): RailArrangement => {
  // Tiles stay in one column, growing to fill the rail's width, for as long
  // as they all fit on the page. Only when they'd run off the bottom do they
  // split into more columns, and only as many as fit horizontally; if even
  // that can't keep them on the page, they scroll in as many columns as fit.
  const maxColumns = Math.max(
    1,
    Math.min(
      tileCount,
      Math.floor((railWidth + railGap) / (minRailWidth + railGap)),
    ),
  );
  const widthFor = (columns: number): number =>
    Math.floor((railWidth - (columns - 1) * railGap) / columns);
  // Rail tiles are 4:3, as they were when they were fixed at 180×135
  const heightFor = (columns: number): number => {
    const rows = Math.ceil(tileCount / columns);
    return (
      rows * Math.floor((widthFor(columns) * 3) / 4) + (rows - 1) * railGap
    );
  };
  let columns = maxColumns;
  for (let c = 1; c < maxColumns; c++)
    if (heightFor(c) <= railHeight) {
      columns = c;
      break;
    }
  const tileWidth = widthFor(columns);
  return { columns, tileWidth, tileHeight: Math.floor((tileWidth * 3) / 4) };
};

const layerStyle = (railWidth: number): LayerCSSProperties => ({
  "--rail-width": `${railWidth}px`,
});

/**
 * An implementation of the "spotlight landscape" layout, in which the spotlight
 * tile takes up most of the space on the left, and the grid of participants is
 * shown as a scrolling rail on the right. The split between the two can be
 * dragged.
 */
export const makeSpotlightLandscapeLayout: CallLayout<
  SpotlightLandscapeLayoutModel
> = ({ minBounds$ }) => ({
  foreground: "scrolling",

  fixed: function SpotlightLandscapeLayoutFixed({
    ref,
    model,
    Slot,
  }): ReactNode {
    useUpdateLayout();
    const { width } = useBehavior(minBounds$);
    const railWidth = useBehavior(model.railWidth$);
    // The width when the drag began; each move reports its delta from there
    const startWidth = useRef(railWidth);

    // The resize handle lives on this layer's empty stand-in for the rail
    // rather than around the rail's slots: re-resizable rewrites the sizes of
    // its element and inserts an overlay while dragging, which would upset
    // the measurement of any slots inside it.
    return (
      <div ref={ref} className={styles.layer} style={layerStyle(railWidth)}>
        <div className={styles.spotlight}>
          <Slot
            className={styles.slot}
            id="spotlight"
            model={model.spotlight}
          />
        </div>
        <Resizable
          className={styles.rail}
          size={{ width: railWidth, height: "100%" }}
          minWidth={minRailWidth}
          // No more than 40% of the page, so that the spotlight always stays
          // clearly the bigger of the two rather than meeting the rail in the
          // middle. A pixel maximum: re-resizable works percentages out by
          // measuring a probe element in the parent, which a CSS grid parent
          // defeats
          maxWidth={Math.max(minRailWidth, width * 0.4)}
          enable={{ left: true }}
          handleClasses={{ left: styles.handle }}
          handleWrapperClass={styles.handleWrapper}
          onResizeStart={(): void => {
            startWidth.current = model.railWidth$.value;
          }}
          onResize={(_e, _direction, _element, delta): void => {
            model.railWidth$.value = startWidth.current + delta.width;
          }}
        />
      </div>
    );
  },

  scrolling: function SpotlightLandscapeLayoutScrolling({
    ref,
    model,
    Slot,
  }): ReactNode {
    useUpdateLayout();
    useVisibleTiles(model.setVisibleTiles);
    const { height } = useBehavior(minBounds$);
    const onDragTile = useReorderTiles(model);
    const railWidth = useBehavior(model.railWidth$);
    // The rail is the grid layout's grid: enlarged tiles take 2×2 cells and
    // the rest flow around them
    const enlarged = useEnlargedTiles(model.grid);
    const cells = cellCount(model.grid.length, enlarged);
    const arrangement = useMemo(
      () => arrangeRail(railWidth, cells, height),
      [railWidth, cells, height],
    );
    const { columns } = arrangement;
    const [hug] = useSetting(hugVideo);
    const aspectRatios = useVideoAspectRatios(model.grid);
    // Hugged tiles are no bigger than their videos make them, so shrink the
    // cells to the widest and tallest of them, as the grid layout does
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
    // as in the grid layout
    const [relaxed] = useSetting(relaxedGrid);
    const rows = useMemo(() => {
      if (!hug || !relaxed) return null;
      const ratios = aspectRatios.map((ar) => ar || tileWidth / tileHeight);
      // Tiles no smaller than the rail's cells, scrolling if need be
      return packRows({ width: railWidth, height }, railGap, ratios, {
        minRowHeight: tileHeight,
        enlarged,
      });
    }, [
      hug,
      relaxed,
      enlarged,
      aspectRatios,
      railWidth,
      height,
      tileWidth,
      tileHeight,
    ]);

    return (
      <div ref={ref} className={styles.layer} style={layerStyle(railWidth)}>
        <SpotlightSlot media$={model.spotlight.media$} />
        <TileGrid
          grid={model.grid}
          enlarged={enlarged}
          gap={railGap}
          tileWidth={tileWidth}
          tileHeight={tileHeight}
          rects={rows ?? undefined}
          columns={columns}
          Slot={Slot}
          onDrag={onDragTile}
        />
      </div>
    );
  },
});

interface SpotlightSlotProps {
  media$: Behavior<MediaViewModel[]>;
}

// This component isolates the subscription to the spotlight media so that it
// can change without causing the whole layout to re-render
const SpotlightSlot: FC<SpotlightSlotProps> = ({ media$ }) => {
  const withIndicators = useBehavior(media$).length > 1;
  return (
    <div
      className={classNames(styles.spotlight, {
        [styles.withIndicators]: withIndicators,
      })}
    />
  );
};
