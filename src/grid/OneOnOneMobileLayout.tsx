/*
Copyright 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useCallback } from "react";
import classNames from "classnames";

import { type OneOnOneMobileLayout as OneOnOneMobileLayoutModel } from "../state/layout-types.ts";
import { type CallLayout } from "./CallLayout";
import styles from "./OneOnOneMobileLayout.module.css";
import { type DragCallback, useUpdateLayout } from "./Grid";
import { useBehavior } from "../useBehavior";
import { droppedPosition, floatingClass, floatingStyle } from "./floating.ts";

/**
 * An implementation of the "one-on-one" layout for mobile platforms, in which
 * the remote participant is shown at maximum size, overlaid by a small view of
 * the local participant.
 */
export const makeOneOnOneMobileLayout: CallLayout<
  OneOnOneMobileLayoutModel
> = () => ({
  foreground: "scrolling",

  fixed: function OneOnOneMobileLayoutFixed({ ref, model, Slot }): ReactNode {
    useUpdateLayout();
    return (
      <div ref={ref} className={styles.layer}>
        <Slot
          className={styles.spotlight}
          id="spotlight"
          model={model.spotlight}
        />
      </div>
    );
  },

  scrolling: function OneOnOneMobileLayoutScrolling({
    ref,
    model,
    Slot,
  }): ReactNode {
    useUpdateLayout();
    const pipSize = useBehavior(model.pipSize$);
    const pipPosition = useBehavior(model.pipPosition$);
    const onDragLocalTile: DragCallback = useCallback(
      (drag) => {
        if (drag.final) model.pipPosition$.value = droppedPosition(drag);
      },
      [model.pipPosition$],
    );

    return (
      <div ref={ref} className={styles.layer}>
        {model.pip && (
          <Slot
            className={classNames(styles.pip, floatingClass)}
            style={floatingStyle(pipPosition)}
            id={model.pip.id}
            model={model.pip}
            onDrag={onDragLocalTile}
            data-size={pipSize}
          />
        )}
      </div>
    );
  },
});
