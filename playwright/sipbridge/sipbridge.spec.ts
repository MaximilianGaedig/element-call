/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "@playwright/test";

import {
  allowDialIn,
  createCallRoom,
  joinCall,
  measure,
  measureImage,
  recordingsSince,
  SipCaller,
} from "./helpers";

// These need the dev stack's sipbridge profile and its SIP caller image,
// so they only run when asked for; see README.md, "SIP bridge tests".
test.skip(
  !process.env.SIPBRIDGE_TESTS,
  "set SIPBRIDGE_TESTS=1 with the sipbridge profile running",
);
test.skip(({ browserName }) => browserName !== "chromium", "chromium only");
// The callers share one SIP port, so one call at a time
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ screenshot: "only-on-failure" });

test("a SIP caller with video joins the call", async ({ page }) => {
  const name = `dialin-${Date.now()}`;
  const { roomId } = await createCallRoom(name);
  await joinCall(page, roomId);

  const address = await allowDialIn(page);
  expect(address).toMatch(/^sip:room-[0-9a-f]+@/);

  const caller = new SipCaller(name, address, 120);
  try {
    await caller.waitEstablished();
    // The caller's tile shows its orange video
    const tiles = page.getByTestId("videoTile");
    await expect(tiles).toHaveCount(2, { timeout: 60_000 });
    await expect
      .poll(
        async () => {
          const measured = await Promise.all(
            (await tiles.locator("video").all()).map(measure),
          );
          return Math.max(...measured.map((m) => m.orange));
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0.5);
    // And the caller sees the call, rendered by the bridge: the browser's
    // green fake camera fills most of its view
    await expect
      .poll(
        async () =>
          (await measureImage(page, caller.snapshot(), "image/png")).green,
        { timeout: 60_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0.1);

    // Recording meanwhile: the recording shows the caller too, and the
    // caller keeps seeing the call. The bot's keys for everyone take a
    // few seconds after it joins, and the thumbnail is the middle frame
    const started = Date.now();
    const record = page.getByTestId("incall_record");
    await record.click();
    await expect(record).toHaveAttribute("aria-checked", "true", {
      timeout: 60_000,
    });
    // The recorder confirms once its widget has joined the call
    await expect(record).toHaveAttribute("aria-busy", "false", {
      timeout: 90_000,
    });
    await page.waitForTimeout(20_000);
    await record.click();
    await expect(record).toHaveAttribute("aria-checked", "false", {
      timeout: 15_000,
    });
    const notice = page
      .getByRole("status")
      .filter({ hasText: "Recording ready" });
    await expect(notice).toBeVisible({ timeout: 180_000 });
    const thumbnail = notice.locator("img");
    await expect(thumbnail).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const { green, orange } = await measure(thumbnail);
          return Math.min(green, orange);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0.1);
    expect(recordingsSince(started)).toHaveLength(1);
    await expect
      .poll(
        async () =>
          (await measureImage(page, caller.snapshot(), "image/png")).green,
        { timeout: 60_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0.1);
  } finally {
    caller.hangup();
  }
  await expect(page.getByTestId("videoTile")).toHaveCount(1, {
    timeout: 60_000,
  });
});

test("the recording shows the call's video", async ({ page }) => {
  const name = `rec-${Date.now()}`;
  const started = Date.now();
  const { roomId } = await createCallRoom(name);
  await joinCall(page, roomId);
  // The browser's fake camera is green, which is what the recording should
  // show
  const ownTile = page.getByTestId("videoTile").locator("video");
  await expect
    .poll(async () => (await measure(ownTile)).green, { timeout: 15_000 })
    .toBeGreaterThan(0.5);

  const record = page.getByTestId("incall_record");
  await expect(record).toHaveAttribute("aria-checked", "false");
  await record.click();
  await expect(record).toHaveAttribute("aria-checked", "true", {
    timeout: 15_000,
  });
  const badge = page.getByRole("status", {
    name: "This call is being recorded",
  });
  await expect(badge).toBeVisible();
  // The recorder joins the call
  await expect(page.getByTestId("videoTile")).toHaveCount(2, {
    timeout: 90_000,
  });
  await page.waitForTimeout(20_000);

  await record.click();
  await expect(record).toHaveAttribute("aria-checked", "false", {
    timeout: 15_000,
  });
  await expect(badge).toHaveCount(0);

  // The bot posts the recording into the room, and the app shows it with
  // the bot's thumbnail, a frame of the recording
  const notice = page
    .getByRole("status")
    .filter({ hasText: "Recording ready" });
  await expect(notice).toBeVisible({ timeout: 180_000 });
  const thumbnail = notice.locator("img");
  await expect(thumbnail).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await measure(thumbnail)).green, { timeout: 15_000 })
    .toBeGreaterThan(0.1);
  // And the bridge kept a copy of the recording
  expect(recordingsSince(started)).toHaveLength(1);
});
