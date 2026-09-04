/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/lib/logger";

import {
  type GridTileMedia,
  GridTileViewModel,
  SpotlightTileViewModel,
} from "./TileViewModel";
import { debugTileLayout } from "../settings/settings";
import { type MediaViewModel } from "./media/MediaViewModel";
import { type UserMediaViewModel } from "./media/UserMediaViewModel";
import { state, type State } from "./Behavior";

type SpotlightBackground = "solid" | "transparent";

function debugEntries(entries: GridTileData[]): string[] {
  return entries.map((e) => e.media.displayName$.value);
}

let DEBUG_ENABLED = false;
debugTileLayout.value$.subscribe((value) => (DEBUG_ENABLED = value));

class SpotlightTileData {
  private readonly media$: State<MediaViewModel[]>;
  public get media(): MediaViewModel[] {
    return this.media$.peek();
  }
  public set media(value: MediaViewModel[]) {
    this.media$.value = value;
  }

  private readonly maximised$: State<boolean>;
  public get maximised(): boolean {
    return this.maximised$.peek();
  }
  public set maximised(value: boolean) {
    this.maximised$.value = value;
  }

  private readonly background$: State<SpotlightBackground>;
  public get background(): SpotlightBackground {
    return this.background$.peek();
  }
  public set background(value: SpotlightBackground) {
    this.background$.value = value;
  }

  public readonly vm: SpotlightTileViewModel;

  public constructor(
    media: MediaViewModel[],
    maximised: boolean,
    background: SpotlightBackground,
  ) {
    this.media$ = state(media);
    this.maximised$ = state(maximised);
    this.background$ = state(background);
    this.vm = new SpotlightTileViewModel(
      this.media$,
      this.maximised$,
      this.background$,
    );
  }
}

class GridTileData {
  private readonly media$: State<GridTileMedia>;
  public get media(): GridTileMedia {
    return this.media$.peek();
  }
  public set media(value: UserMediaViewModel) {
    this.media$.value = value;
  }

  public readonly vm: GridTileViewModel;

  public constructor(media: GridTileMedia) {
    this.media$ = state(media);
    this.vm = new GridTileViewModel(this.media$);
  }
}

/**
 * An immutable collection of tiles to be mapped to a layout.
 */
export class TileStore {
  private constructor(
    private readonly spotlight: SpotlightTileData | null,
    private readonly grid: GridTileData[],
    /**
     * A number incremented on each update, just for debugging purposes.
     */
    public readonly generation: number,
  ) {}

  public readonly spotlightTile = this.spotlight?.vm;
  public readonly spotlightMedia = this.spotlight?.media ?? [];
  public readonly gridTiles = this.grid.map(({ vm }) => vm);
  public readonly gridMedia = this.grid.map(({ media }) => media);
  public readonly gridTilesByMedia = new Map(
    this.grid.map(({ vm, media }) => [media, vm]),
  );

  /**
   * Creates an an empty collection of tiles.
   */
  public static empty(): TileStore {
    return new TileStore(null, [], 0);
  }

  /**
   * Creates a builder which can be used to update the collection, passing
   * ownership of the tiles to the updated collection.
   */
  public from(): TileStoreBuilder {
    return new TileStoreBuilder(
      this.spotlight,
      this.grid,
      (spotlight, grid) => new TileStore(spotlight, grid, this.generation + 1),
      this.generation,
    );
  }
}

/**
 * A builder for a new collection of tiles. Grid tiles appear in the order they
 * are registered, reusing tiles from the previous collection for the same
 * media, and destroying tiles that are no longer used.
 */
export class TileStoreBuilder {
  private spotlight: SpotlightTileData | null = null;
  private readonly prevSpotlightSpeaker: UserMediaViewModel | null =
    this.prevSpotlight?.media[0] !== undefined &&
    "speaking$" in this.prevSpotlight.media[0]
      ? this.prevSpotlight.media[0]
      : null;

  private readonly prevGridByMedia: Map<MediaViewModel, GridTileData> = new Map(
    this.prevGrid.map((entry) => [entry.media, entry]),
  );

  private readonly grid: GridTileData[] = [];

  public constructor(
    private readonly prevSpotlight: SpotlightTileData | null,
    private readonly prevGrid: GridTileData[],
    private readonly construct: (
      spotlight: SpotlightTileData | null,
      grid: GridTileData[],
    ) => TileStore,
    /**
     * A number incremented on each update, just for debugging purposes.
     */
    private readonly generation: number,
  ) {}

  /**
   * Sets the contents of the spotlight tile. If this is never called, there
   * will be no spotlight tile.
   */
  public registerSpotlight(
    media: MediaViewModel[],
    maximised: boolean,
    background: SpotlightBackground = "solid",
  ): void {
    if (DEBUG_ENABLED)
      logger.debug(
        `[TileStore, ${this.generation}] register spotlight: ${media.map((m) => m.displayName$.value)}`,
      );

    if (this.spotlight !== null) throw new Error("Spotlight already set");
    if (this.grid.length > 0)
      throw new Error("Spotlight must be registered before grid tiles");

    // Reuse the previous spotlight tile if it exists
    if (this.prevSpotlight === null) {
      this.spotlight = new SpotlightTileData(media, maximised, background);
    } else {
      this.spotlight = this.prevSpotlight;
      this.spotlight.media = media;
      this.spotlight.maximised = maximised;
      this.spotlight.background = background;
    }
  }

  /**
   * Sets up a grid tile for the given media. If this is never called for some
   * media, then that media will have no grid tile.
   */
  public registerGridTile(media: GridTileMedia): void {
    if (DEBUG_ENABLED)
      logger.debug(
        `[TileStore, ${this.generation}] register grid tile: ${media.displayName$.value}`,
      );

    if (this.spotlight !== null) {
      // We actually *don't* want spotlight speakers to appear in both the
      // spotlight and the grid, so they're filtered out here
      if (
        !(media.type === "user" && media.local && !media.pinned$.value) &&
        this.spotlight.media.includes(media)
      )
        return;
      // When the spotlight speaker changes, the previous speaker takes the
      // new speaker's place in the grid (see reconcileOrder). Reuse the new
      // speaker's tile with the media swapped out, so that the tile itself
      // stays put rather than one tile leaving and another arriving.
      const [spotlit] = this.spotlight.media;
      if (
        media === this.prevSpotlightSpeaker &&
        spotlit !== undefined &&
        "speaking$" in spotlit &&
        spotlit !== media
      ) {
        const entry = this.prevGridByMedia.get(spotlit);
        if (entry !== undefined) {
          entry.media = media;
          this.prevGridByMedia.delete(spotlit);
          this.grid.push(entry);
          return;
        }
      }
    }

    // Reuse the previous tile for this media if there was one
    this.grid.push(this.prevGridByMedia.get(media) ?? new GridTileData(media));
  }

  /**
   * Sets up a PiP tile for the given media. This is a special kind of grid tile
   * that is expected to stand on its own and switch between speakers, so this
   * method will more eagerly try to reuse an existing tile, replacing its
   * media, than registerGridTile would.
   */
  public registerPipTile(media: UserMediaViewModel): void {
    if (DEBUG_ENABLED)
      logger.debug(
        `[TileStore, ${this.generation}] register PiP tile: ${media.displayName$.value}`,
      );

    // If there is a single grid tile that we can reuse
    if (this.prevGrid.length === 1) {
      const entry = this.prevGrid[0];
      // Do the media swap
      entry.media = media;
      this.grid.push(entry);
    } else {
      this.grid.push(new GridTileData(media));
    }
  }

  /**
   * Constructs a new collection of all registered tiles, transferring ownership
   * of the tiles to the new collection. Any tiles present in the previous
   * collection but not the new collection will be destroyed.
   */
  public build(): TileStore {
    if (DEBUG_ENABLED)
      logger.debug(
        `[TileStore, ${this.generation}] result: ${debugEntries(this.grid)}`,
      );
    return this.construct(this.spotlight, this.grid);
  }
}
