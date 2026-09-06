/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { type FC } from "react";

import { TileGrid } from "./TileGrid";
import { type SlotProps } from "./Grid";
import { GridTileViewModel, type GridTileMedia } from "../state/TileViewModel";
import { constant } from "../state/Behavior";
import { relaxedGrid } from "../settings/settings";

vi.mock("./Grid", () => ({ useUpdateLayout: () => {} }));

const Slot: FC<SlotProps<unknown>> = ({ id, style }) => (
  <div data-testid={id} style={style} />
);

const portrait = new GridTileViewModel(
  constant({
    type: "user",
    videoEnabled$: constant(true),
    videoAspectRatio$: constant(0.5),
    moderation$: constant({ pinned: false }),
  } as Partial<GridTileMedia> as GridTileMedia),
);

afterEach(() => relaxedGrid.setValue(false));

test.each([
  ["lines tiles up in columns", false, ""],
  [
    "packs rows when relaxed",
    true,
    "min(var(--width), calc(var(--height) * 0.5))",
  ],
])("%s", (_, relaxed, width) => {
  relaxedGrid.setValue(relaxed);
  const { getByTestId } = render(
    <TileGrid
      grid={[portrait]}
      enlarged={[false]}
      gap={20}
      tileWidth={300}
      tileHeight={200}
      columns={1}
      Slot={Slot}
      onDrag={() => () => {}}
    />,
  );
  expect(getByTestId(portrait.id).style.width).toBe(width);
});
