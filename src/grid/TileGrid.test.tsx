/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { type FC } from "react";

import { TileGrid, videoAspectRatio } from "./TileGrid";
import { type SlotProps } from "./Grid";
import { GridTileViewModel, type GridTileMedia } from "../state/TileViewModel";
import { constant } from "../state/Behavior";
import { type MediaViewModel } from "../state/media/MediaViewModel";

const Slot: FC<SlotProps<unknown>> = ({ id, style }) => (
  <div data-testid={id} style={style} />
);

const tile = new GridTileViewModel(
  constant({
    type: "user",
    moderation$: constant({ pinned: false }),
  } as Partial<GridTileMedia> as GridTileMedia),
);

test.each([
  ["sizes slots by the grid", undefined, ""],
  ["sizes slots by the layout's widths", [123], "123px"],
])("%s", (_, widths, width) => {
  const { getByTestId } = render(
    <TileGrid
      grid={[tile]}
      enlarged={[false]}
      gap={20}
      tileWidth={300}
      tileHeight={200}
      columns={1}
      widths={widths}
      Slot={Slot}
      onDrag={() => () => {}}
    />,
  );
  expect(getByTestId(tile.id).style.width).toBe(width);
});

test("a user's tile is 16:9 until their video shows its shape", () => {
  const user = (ratio: number): MediaViewModel =>
    ({
      type: "user",
      videoAspectRatio$: constant(ratio),
    }) as Partial<MediaViewModel> as MediaViewModel;
  expect(videoAspectRatio(user(NaN))).toBeCloseTo(16 / 9);
  expect(videoAspectRatio(user(9 / 16))).toBeCloseTo(9 / 16);
  // Other media, such as screen shares, aren't shaped this way
  expect(
    videoAspectRatio({
      type: "screen share",
    } as Partial<MediaViewModel> as MediaViewModel),
  ).toBe(0);
});
