/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useCallback } from "react";
import classNames from "classnames";

import { type SpotlightExpandedLayout as SpotlightExpandedLayoutModel } from "../state/layout-types.ts";
import { type CallLayout } from "./CallLayout";
import { type DragCallback, useUpdateLayout } from "./Grid";
import styles from "./SpotlightExpandedLayout.module.css";
import { useBehavior } from "../useBehavior";
import { droppedPosition, floatingClass, floatingStyle } from "./floating.ts";

/**
 * An implementation of the "expanded spotlight" layout, in which the spotlight
 * tile stretches edge-to-edge and is overlaid by a picture-in-picture tile.
 */
export const makeSpotlightExpandedLayout: CallLayout<
  SpotlightExpandedLayoutModel
> = () => ({
  foreground: "scrolling",

  fixed: function SpotlightExpandedLayoutFixed({
    ref,
    model,
    Slot,
  }): ReactNode {
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

  scrolling: function SpotlightExpandedLayoutScrolling({
    ref,
    model,
    Slot,
  }): ReactNode {
    useUpdateLayout();
    const pipPosition = useBehavior(model.pipPosition$);

    const onDragPip: DragCallback = useCallback(
      (drag) => (model.pipPosition$.value = droppedPosition(drag)),
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
            onDrag={onDragPip}
          />
        )}
      </div>
    );
  },
});
