/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, it } from "vitest";

import { TileStore } from "./TileStore";

it("survives a previous spotlight that had no media", () => {
  const update = TileStore.empty().from();
  update.registerSpotlight([], false);
  const tiles = update.build();
  expect(() => tiles.from().build()).not.toThrow();
});
