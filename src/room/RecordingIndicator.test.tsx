/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { type Room } from "matrix-js-sdk";

import { RecordingIndicator } from "./RecordingIndicator";
import { state } from "../state/Behavior";
import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type RecordingState } from "../state/Recording";

const room = {
  getMember: (id: string) =>
    id === "@alice:e" ? { rawDisplayName: "Alice" } : null,
} as unknown as Room;

function setup(by: string, localUserId: string, started = true): void {
  const recording$ = state<RecordingState | null>({
    by,
    recorder: "@bot:e",
    media: "video",
    streams: "composite",
    eventId: "$1",
    started,
  });
  const vm = { recording: { recording$ } } as unknown as CallViewModel;
  render(<RecordingIndicator vm={vm} room={room} localUserId={localUserId} />);
}

test("names who is recording until acknowledged, and keeps the badge", async () => {
  setup("@alice:e", "@bob:e");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Alice is recording this call",
  );
  await userEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("REC");
});

test("gives the person recording only the badge", () => {
  setup("@alice:e", "@alice:e");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

test("marks the badge busy until the recorder confirms", () => {
  setup("@alice:e", "@alice:e", false);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
});
