/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test } from "vitest";

import { constant, state } from "./Behavior";
import { GridTileViewModel } from "./TileViewModel";
import { enlargeActiveSpeakers } from "../settings/settings";
import {
  mockRemoteMedia,
  mockRemoteParticipant,
  mockRtcMembership,
} from "../utils/test";

afterEach(() => enlargeActiveSpeakers.setValue(false));

test("an active speaker is enlarged only when the setting is on", () => {
  const isSpeaker$ = state(false);
  const media = {
    ...mockRemoteMedia(
      mockRtcMembership("@alice:example.org", "AAAA"),
      {},
      mockRemoteParticipant({}),
    ),
    isSpeaker$,
  };
  const tile = new GridTileViewModel(constant(media));
  expect(tile.enlarged$.value).toBe(false);
  isSpeaker$.value = true;
  expect(tile.enlarged$.value).toBe(false);
  enlargeActiveSpeakers.setValue(true);
  expect(tile.enlarged$.value).toBe(true);
  // The user's own choice wins
  tile.toggleEnlarged();
  expect(tile.enlarged$.value).toBe(false);
  tile.toggleEnlarged();
  expect(tile.enlarged$.value).toBe(true);
});
