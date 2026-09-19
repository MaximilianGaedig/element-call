/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CSSProperties } from "react";

import { type FloatingPosition } from "../state/layout-types.ts";
import { type DragCallback } from "./Grid.tsx";
import styles from "./Floating.module.css";

/**
 * How close to an edge, in pixels, a dropped tile snaps. This is the smallest
 * margin any layout keeps from its edges (--cpd-space-4x, in the one-on-one
 * layouts), so that a tile dropped within its margin sits flush against it.
 * Layouts with bigger margins clamp the tile to them in CSS anyway; snapping
 * only decides whether it also stays flush when the window resizes.
 */
const snap = 16;

/**
 * Where a floating tile should settle after being dropped: exactly where it
 * was left, except that it snaps to any edge it lands near. The CSS clamps
 * it to the layout's margins.
 */
export function droppedPosition({
  containerX,
  containerY,
  container,
  tile,
}: Parameters<DragCallback>[0]): FloatingPosition {
  const settle = (offset: number, travel: number): number => {
    if (!(offset > snap)) return 0;
    if (offset > travel - snap) return Infinity;
    return offset;
  };
  return {
    x: settle(containerX, container.width - tile.width),
    y: settle(containerY, container.height - tile.height),
  };
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
