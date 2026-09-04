/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CSSProperties, type FC, type ReactNode, useRef } from "react";
import classNames from "classnames";
import { Resizable } from "re-resizable";

import { type CallLayout } from "./CallLayout";
import { type SpotlightLandscapeLayout as SpotlightLandscapeLayoutModel } from "../state/layout-types.ts";
import styles from "./SpotlightLandscapeLayout.module.css";
import { useUpdateLayout, useVisibleTiles } from "./Grid";
import { type MediaViewModel } from "../state/media/MediaViewModel.ts";
import { type Behavior } from "../state/Behavior.ts";
import { useBehavior } from "../useBehavior.ts";
import { useReorderTiles } from "./reorder.ts";

interface LayerCSSProperties extends CSSProperties {
  "--rail-width": string;
  "--rail-tile-width": string;
  "--rail-tile-height": string;
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
const layerStyle = (
  railWidth: number,
  tileCount: number,
  railHeight: number,
): LayerCSSProperties => {
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
  return {
    "--rail-width": `${railWidth}px`,
    "--rail-tile-width": `${tileWidth}px`,
    "--rail-tile-height": `${Math.floor((tileWidth * 3) / 4)}px`,
  };
};

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
    const { width, height } = useBehavior(minBounds$);
    const railWidth = useBehavior(model.railWidth$);
    // The width when the drag began; each move reports its delta from there
    const startWidth = useRef(railWidth);

    // The resize handle lives on this layer's empty stand-in for the rail
    // rather than around the rail's slots: re-resizable rewrites the sizes of
    // its element and inserts an overlay while dragging, which would upset
    // the measurement of any slots inside it.
    return (
      <div
        ref={ref}
        className={styles.layer}
        style={layerStyle(railWidth, model.grid.length, height)}
      >
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

    return (
      <div
        ref={ref}
        className={styles.layer}
        style={layerStyle(railWidth, model.grid.length, height)}
      >
        <SpotlightSlot media$={model.spotlight.media$} />
        <div className={styles.grid}>
          {model.grid.map((m) => (
            <Slot
              key={m.id}
              className={styles.slot}
              id={m.id}
              model={m}
              onDrag={onDragTile(m)}
            />
          ))}
        </div>
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
