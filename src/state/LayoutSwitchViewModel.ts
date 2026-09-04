/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type WindowMode } from "./CallViewModel/CallViewModel.ts";
import { type Behavior, computed, state } from "./Behavior.ts";
import { type Scope } from "./Scope.ts";

export type LayoutMode = "spotlight" | "grid";

export interface LayoutSwitchViewModel {
  /**
   * The layout mode of the call's media tiles.
   */
  layout$: Behavior<LayoutMode>;
  setLayout: (value: LayoutMode) => void;
}

/**
 * Creates a layout mode switch that allows switching between grid and spotlight layouts.
 * The actual layout mode might switch automatically to spotlight if there is a
 * screen share active or if the window mode is flat.
 *
 * @param scope - The observable scope to manage subscriptions.
 * @param windowMode$ - The current window mode.
 * @param hasScreenShares$ - A behavior indicating if there are screen shares active.
 */
export function createLayoutSwitchViewModel(
  scope: Scope,
  windowMode$: Behavior<WindowMode>,
  hasScreenShares$: Behavior<boolean>,
): LayoutSwitchViewModel {
  /**
   * The natural layout - the layout that the interface would prefer to be in,
   * not accounting for the user's manual selections.
   */
  const naturalLayout$ = computed<LayoutMode>(() => {
    // When the window is flat (as with a phone in landscape orientation),
    // grid is preferable as there's usually more than enough horizontal
    // space to fit in some grid tiles on the side.
    if (windowMode$.value === "flat") return "grid";
    // When there are screen shares, spotlight is a better experience. We
    // want them to be big and readable.
    return hasScreenShares$.value ? "spotlight" : "grid";
  });

  /**
   * The layout the user has manually selected, or null to follow the natural
   * layout.
   */
  const selection$ = state<LayoutMode | null>(null);

  // A manual selection of grid is only respected until the natural layout
  // catches up with it; after that we follow the natural layout again. A manual
  // selection of spotlight sticks until the user changes it.
  scope.effect(() => {
    if (selection$.value === "grid" && naturalLayout$.value === "grid")
      selection$.value = null;
  });

  return {
    layout$: computed(() => selection$.value ?? naturalLayout$.value),
    setLayout: (value) => {
      selection$.value = value === naturalLayout$.value ? null : value;
    },
  };
}
