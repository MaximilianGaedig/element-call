/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Behavior, state } from "./Behavior";
import { type MediaViewModel } from "./media/MediaViewModel";
import { type RingingMediaViewModel } from "./media/RingingMediaViewModel";
import { type UserMediaViewModel } from "./media/UserMediaViewModel";

let nextId = 0;
function createId(): string {
  return (nextId++).toString();
}

export class GridTileViewModel {
  public readonly id = createId();
  private readonly _showOutline$ = state(false);
  public readonly showOutline$: Behavior<boolean> = this._showOutline$;
  private readonly _enlarged$ = state(false);
  /**
   * Whether the user has asked for this tile to take up twice the space in
   * the grid.
   */
  public readonly enlarged$: Behavior<boolean> = this._enlarged$;

  public constructor(
    public readonly media$: Behavior<
      UserMediaViewModel | RingingMediaViewModel
    >,
  ) {}

  public setShowOutline(value: boolean): void {
    this._showOutline$.value = value;
  }

  public toggleEnlarged(): void {
    this._enlarged$.value = !this._enlarged$.value;
  }
}

export class SpotlightTileViewModel {
  public constructor(
    public readonly media$: Behavior<MediaViewModel[]>,
    public readonly maximised$: Behavior<boolean>,
    public readonly background$: Behavior<"solid" | "transparent">,
  ) {}
}

export type TileViewModel = GridTileViewModel | SpotlightTileViewModel;
