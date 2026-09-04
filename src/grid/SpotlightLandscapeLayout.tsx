/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CSSProperties, type FC, type ReactNode } from "react";
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
}

const layerStyle = (railWidth: number): LayerCSSProperties => ({
  "--rail-width": `${railWidth}px`,
});

const minRailWidth = 180;

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
    useBehavior(minBounds$);
    const railWidth = useBehavior(model.railWidth$);

    return (
      <div ref={ref} className={styles.layer} style={layerStyle(railWidth)}>
        <div className={styles.spotlight}>
          <Slot
            className={styles.slot}
            id="spotlight"
            model={model.spotlight}
          />
        </div>
        <div className={styles.grid} />
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
    useBehavior(minBounds$);
    const onDragTile = useReorderTiles(model);
    const railWidth = useBehavior(model.railWidth$);

    return (
      <div ref={ref} className={styles.layer} style={layerStyle(railWidth)}>
        <SpotlightSlot media$={model.spotlight.media$} />
        <Resizable
          className={styles.rail}
          size={{ width: railWidth, height: "100%" }}
          minWidth={minRailWidth}
          maxWidth="70%"
          enable={{ left: true }}
          handleClasses={{ left: styles.handle }}
          onResize={(_e, _direction, element): void => {
            model.railWidth$.value = element.offsetWidth;
          }}
        >
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
        </Resizable>
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
