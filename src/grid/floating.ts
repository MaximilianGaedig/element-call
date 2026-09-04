/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CSSProperties } from "react";

import { type FloatingPosition } from "../state/layout-types.ts";
import { type DragCallback } from "./Grid.tsx";
import styles from "./Floating.module.css";

/** How close to an edge (as a fraction of the travel) a dropped tile snaps. */
const snap = 0.1;

/**
 * Where a floating tile should settle after being dropped: clamped to the
 * layout, and snapped to any edge it lands near.
 */
export function droppedPosition({
  xRatio,
  yRatio,
}: Parameters<DragCallback>[0]): FloatingPosition {
  const settle = (ratio: number): number => {
    if (!(ratio > snap)) return 0;
    if (ratio > 1 - snap) return 1;
    return ratio;
  };
  return { x: settle(xRatio), y: settle(yRatio) };
}

export const floatingClass = styles.floating;

interface FloatingCSSProperties extends CSSProperties {
  "--floating-x": number;
  "--floating-y": number;
}

/**
 * The style to apply to a floating tile's slot to place it.
 */
export function floatingStyle({ x, y }: FloatingPosition): CSSProperties {
  return { "--floating-x": x, "--floating-y": y } as FloatingCSSProperties;
}
