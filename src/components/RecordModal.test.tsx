/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { axe } from "vitest-axe";
import userEvent from "@testing-library/user-event";

import { RecordModal } from "./RecordModal";
import { mockConfig } from "../utils/test";

// The modal reads the deployment's config for its defaults
mockConfig();

test("RecordModal is accessible and starts with the chosen options", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  const onStart = vi.fn();
  const { container } = render(
    <RecordModal open={true} onDismiss={onDismiss} onStart={onStart} />,
  );
  expect(await axe(container)).toHaveNoViolations();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onDismiss).toHaveBeenCalled();
  expect(onStart).not.toHaveBeenCalled();

  const mirror = screen.getByRole("checkbox", {
    name: "Mirror my layout / audio levels in the recording",
  });
  await user.click(mirror);
  expect(mirror).toBeChecked();
  // An audio recording still has levels to mirror
  await user.click(screen.getByRole("checkbox", { name: "Record audio only" }));
  expect(mirror).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Start recording" }));
  expect(onStart).toHaveBeenCalledWith({
    audioOnly: true,
    requireConsent: false,
    mirrorLayout: true,
  });
});
