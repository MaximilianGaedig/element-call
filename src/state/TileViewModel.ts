/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Behavior, computed, state } from "./Behavior";
import { type MediaViewModel } from "./media/MediaViewModel";
import { type RingingMediaViewModel } from "./media/RingingMediaViewModel";
import { type ScreenShareViewModel } from "./media/ScreenShareViewModel";
import { type UserMediaViewModel } from "./media/UserMediaViewModel";
import { type WrappedUserMediaViewModel } from "./media/WrappedUserMediaViewModel";
import { enlargeActiveSpeakers } from "../settings/settings";

let nextId = 0;
function createId(): string {
  return (nextId++).toString();
}

/** The media a grid tile can show. */
export type GridTileMedia =
  | UserMediaViewModel
  | ScreenShareViewModel
  | RingingMediaViewModel;

export class GridTileViewModel {
  public readonly id = createId();
  private readonly _showOutline$ = state(false);
  public readonly showOutline$: Behavior<boolean> = this._showOutline$;
  /** The user's own choice, overriding the automatic enlargement below. */
  private readonly _enlarged$ = state<boolean | null>(null);
  /**
   * Whether this tile takes up twice the space in the grid: because the user
   * asked for it, because it's a screen share, because a moderator pinned the
   * media (which in the grid layout means enlarging it), or because the media
   * is an active speaker and the user has chosen to enlarge those.
   */
  public readonly enlarged$: Behavior<boolean> = computed(() => {
    const chosen = this._enlarged$.value;
    if (chosen !== null) return chosen;
    const media = this.media$.value;
    if (media.type === "screen share") return true;
    if (media.type !== "user") return false;
    if (media.moderation$.value.pinned) return true;
    // Grid tiles are given the wrapped media at runtime, which carries the
    // speaker state (with hysteresis) that the grid ordering uses
    const speaker = (media as Partial<WrappedUserMediaViewModel>).isSpeaker$;
    return enlargeActiveSpeakers.value$.value && (speaker?.value ?? false);
  });

  public constructor(public readonly media$: Behavior<GridTileMedia>) {}

  public setShowOutline(value: boolean): void {
    this._showOutline$.value = value;
  }

  public toggleEnlarged(): void {
    this._enlarged$.value = !this.enlarged$.value;
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
