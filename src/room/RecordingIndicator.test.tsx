/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { type Room } from "matrix-js-sdk";
import { TooltipProvider } from "@vector-im/compound-web";

import {
  DirectingNotice,
  RecordingBadge,
  RecordingNotice,
} from "./RecordingIndicator";
import { constant, state } from "../state/Behavior";
import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type RecordingState } from "../state/Recording";

const room = {
  getMember: (id: string) =>
    id === "@alice:e" ? { rawDisplayName: "Alice" } : null,
} as unknown as Room;

function setup(
  by: string,
  localUserId: string,
  started = true,
  consent: Partial<RecordingState> = {},
): ReturnType<typeof vi.fn> {
  const recording$ = state<RecordingState | null>({
    by,
    recorder: "@bot:e",
    media: "video",
    streams: "composite",
    eventId: "$1",
    started,
    requiresConsent: false,
    consents: {},
    awaitingConsent: [],
    ...consent,
  });
  const consentFn = vi.fn().mockResolvedValue(undefined);
  const vm = {
    recording: { recording$, consent: consentFn },
    directingRecording$: constant(false),
  } as unknown as CallViewModel;
  render(
    <TooltipProvider>
      <RecordingBadge vm={vm} room={room} />
      <RecordingNotice vm={vm} room={room} localUserId={localUserId} />
    </TooltipProvider>,
  );
  return consentFn;
}

test("names who is recording until acknowledged, and keeps the badge", async () => {
  setup("@alice:e", "@bob:e");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Alice is recording this call",
  );
  await userEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("REC");
  expect(screen.getByRole("status")).toHaveAccessibleName(
    "Call is being recorded by Alice (@alice:e)",
  );
});

test("gives the person recording only the badge", () => {
  setup("@alice:e", "@alice:e");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

test("marks the badge busy until the recorder confirms", () => {
  setup("@alice:e", "@alice:e", false);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveAccessibleName(
    "Recording by Alice (@alice:e) is starting",
  );
});

test("asks for consent until answered, and says who is still to consent", async () => {
  const consent = setup("@alice:e", "@bob:e", false, {
    requiresConsent: true,
    awaitingConsent: ["@bob:e", "@carol:e"],
  });
  // The dialog hides the rest of the page from assistive technology
  expect(screen.getByRole("status", { hidden: true })).toHaveAccessibleName(
    "Recording by Alice (@alice:e) is waiting for 2 people to consent",
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Alice wants to record this call",
  );
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(consent).toHaveBeenCalledWith(false);
});

test("asks nothing of those who have already consented", () => {
  setup("@alice:e", "@bob:e", false, {
    requiresConsent: true,
    consents: { "@bob:e": true },
    awaitingConsent: ["@carol:e"],
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("warns whoever directs the recording for as long as they do", () => {
  const recording$ = state<RecordingState | null>({
    by: "@alice:e",
    recorder: "@bot:e",
    media: "audio",
    streams: "composite",
    eventId: "$1",
    started: true,
    requiresConsent: false,
    consents: {},
    awaitingConsent: [],
    directorDevice: "ALICEDEV",
  });
  const directingRecording$ = state(true);
  const vm = {
    recording: { recording$ },
    directingRecording$,
  } as unknown as CallViewModel;
  render(<DirectingNotice vm={vm} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "The recording mirrors your audio levels",
  );
  act(() => {
    directingRecording$.value = false;
  });
  expect(screen.queryByRole("status")).toBeNull();
});
