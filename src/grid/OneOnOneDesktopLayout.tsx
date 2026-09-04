/*
Copyright 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useCallback, useMemo } from "react";
import classNames from "classnames";

import { type OneOnOneDesktopLayout as OneOnOneDesktopLayoutModel } from "../state/layout-types.ts";
import { type CallLayout, arrangeTiles } from "./CallLayout";
import styles from "./OneOnOneDesktopLayout.module.css";
import { type DragCallback, useUpdateLayout } from "./Grid";
import { useBehavior } from "../useBehavior";
import { droppedPosition, floatingClass, floatingStyle } from "./floating.ts";

/**
 * An implementation of the "one-on-one" layout for desktop platforms, in which
 * the remote participant is shown at maximum size, overlaid by a small view of
 * the local participant.
 */
export const makeOneOnOneDesktopLayout: CallLayout<
  OneOnOneDesktopLayoutModel
> = ({ minBounds$ }) => ({
  foreground: "fixed",

  fixed: function OneOnOneDesktopLayoutFixed({ ref }): ReactNode {
    useUpdateLayout();
    return <div ref={ref} />;
  },

  scrolling: function OneOnOneDesktopLayoutScrolling({
    ref,
    model,
    Slot,
  }): ReactNode {
    useUpdateLayout();
    const { width, height } = useBehavior(minBounds$);
    const pipPosition = useBehavior(model.pipPosition$);
    const { tileWidth, tileHeight } = useMemo(
      () => arrangeTiles(width, height, 1),
      [width, height],
    );

    const onDragLocalTile: DragCallback = useCallback(
      (drag) => (model.pipPosition$.value = droppedPosition(drag)),
      [model.pipPosition$],
    );

    return (
      <div ref={ref} className={styles.layer}>
        <Slot
          id={model.spotlight.id}
          model={model.spotlight}
          className={styles.container}
          style={{ width: tileWidth, height: tileHeight }}
        >
          <Slot
            className={classNames(styles.local, floatingClass)}
            style={floatingStyle(pipPosition)}
            id={model.pip.id}
            model={model.pip}
            onDrag={onDragLocalTile}
          />
        </Slot>
      </div>
    );
  },
});
