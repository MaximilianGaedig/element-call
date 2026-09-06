/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

import { SynapseAdmin } from "../utils/synapse-admin";

// Helpers for the tests that drive the dev stack's matrixrtc-sip-bridge
// (docker-compose-dev.yml, profile sipbridge) from the recording and dial-in
// features. See README.md, "SIP bridge tests".

export const HS = "https://synapse.m.localhost";
const REPO = join(import.meta.dirname, "..", "..");
const CALLER_OUT = join(REPO, "backend", "sipcaller_tmp");

export interface RoomUser {
  access_token: string;
  user_id: string;
}

export async function cs<T = Record<string, unknown>>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`${HS}/_matrix/client/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok)
    throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/**
 * An encrypted room where anyone may moderate the call and invite the bot,
 * created by a throwaway admin user (the browser joins as a guest, so the
 * power levels have to let guests do everything the tests need). Encrypted
 * because the bridge always encrypts its media, so the call must too.
 */
export async function createCallRoom(
  name: string,
): Promise<{ roomId: string; creator: RoomUser }> {
  const creator = await new SynapseAdmin().registerUser(
    `${name}-creator`,
    "pw",
    undefined,
    true,
  );
  const { room_id: roomId } = await cs<{ room_id: string }>(
    creator.access_token,
    "POST",
    "/createRoom",
    {
      visibility: "private",
      preset: "public_chat",
      name,
      room_alias_name: name,
      initial_state: [
        {
          type: "m.room.encryption",
          state_key: "",
          content: { algorithm: "m.megolm.v1.aes-sha2" },
        },
      ],
      power_level_content_override: {
        events: { "org.matrix.msc3401.call.member": 0 },
        state_default: 0,
        invite: 0,
      },
    },
  );
  return { roomId, creator };
}

/** Join the call as a guest called Subject, with a fake camera */
export async function joinCall(page: Page, roomId: string): Promise<void> {
  await page.goto(`/room/#?roomId=${encodeURIComponent(roomId)}`);
  await page.getByTestId("joincall_displayName").fill("Subject");
  await page.getByTestId("joincall_joincall").click();
  await expect(page.getByTestId("lobby_joinCall")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("lobby_joinCall").click();
  await expect(page.getByTestId("videoTile")).toHaveCount(1, {
    timeout: 30_000,
  });
}

/**
 * Allow dial-in with video from the moderator settings and return the
 * address the bridge answered with.
 */
export async function allowDialIn(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Moderator settings" }).click();
  await page.locator("#sipDialIn").selectOption("video");
  const address = page.getByRole("dialog").locator("a[href^='sip:']");
  await expect(address).toBeVisible({ timeout: 30_000 });
  const href = await address.getAttribute("href");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return href!;
}

/**
 * The share of pixels in an image or video frame that are the caller's
 * orange and the share that are the green of Chromium's fake camera, both
 * 0-1.
 */
export interface Pixels {
  orange: number;
  green: number;
}

const measurePixels = (source: HTMLImageElement | HTMLVideoElement): Pixels => {
  const w = 64;
  const h = 48;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let orange = 0;
  let green = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 180 && g > 70 && g < 180 && b < 90) orange++;
    if (g > 90 && r < g - 60 && b < g - 60) green++;
  }
  return { orange: orange / (w * h), green: green / (w * h) };
};

/** Measure a video or img element on the page */
export async function measure(element: Locator): Promise<Pixels> {
  return element.evaluate(measurePixels);
}

/** Measure an image file, decoded by the browser */
export async function measureImage(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<Pixels> {
  await page.evaluate(
    async (src) => {
      const img = document.createElement("img");
      img.id = "measured-image";
      img.hidden = true;
      img.src = src;
      document.body.append(img);
      await img.decode();
    },
    `data:${mime};base64,${bytes.toString("base64")}`,
  );
  const img = page.locator("#measured-image");
  const pixels = await img.evaluate(measurePixels);
  await img.evaluate((el) => el.remove());
  return pixels;
}

/** Recordings the bridge saved since the given time, newest first */
export function recordingsSince(time: number): string[] {
  const dir = join(REPO, "backend", "sipbridge_recordings");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".webm") && statSync(join(dir, f)).mtimeMs > time)
    .sort()
    .reverse();
}

const compose = [
  "compose",
  "-f",
  "docker-compose-dev.yml",
  "--profile",
  "sipbridge",
];

/**
 * A baresip caller with VP8 video in a container next to the bridge (the
 * sipcaller service in docker-compose-dev.yml). It sends solid orange
 * video and a 440 Hz tone, and can snapshot what it receives.
 */
export class SipCaller {
  private container: string;
  private outDir: string;

  /** Dial the address, hanging up after the given number of seconds */
  public constructor(
    private name: string,
    address: string,
    seconds: number,
  ) {
    // The address names the host's published port; inside the bridge's
    // network namespace that's loopback
    const uri = address.replace(/@[^:;]+/, "@127.0.0.1");
    this.outDir = join(CALLER_OUT, name);
    this.container = execFileSync(
      "docker",
      [
        ...compose,
        "run",
        "--rm",
        "-d",
        "--name",
        `sipcaller-${name}`,
        "-w",
        `/out/${name}`,
        "sipcaller",
        uri,
        String(seconds),
      ],
      { cwd: REPO, encoding: "utf8" },
    ).trim();
  }

  /** Run a baresip command over its ctrl_tcp module */
  private command(command: string): string {
    const json = JSON.stringify({ command, params: "" });
    const r = spawnSync(
      "docker",
      [
        "exec",
        this.container,
        "sh",
        "-c",
        `printf '%s' '${json.length}:${json},' | nc -w 2 127.0.0.1 4444`,
      ],
      { encoding: "utf8" },
    );
    return r.stdout + r.stderr;
  }

  /** baresip's output so far, without its status line updates */
  public log(): string {
    const r = spawnSync("docker", ["logs", this.container], {
      encoding: "utf8",
    });
    return (r.stdout + r.stderr)
      .split(/\r?\n/)
      .filter((line) => !/^\[\d+:\d\d:\d\d\] audio=/.test(line))
      .join("\n");
  }

  /** Wait until baresip reports the call established */
  public async waitEstablished(ms = 60_000): Promise<void> {
    const until = Date.now() + ms;
    let log = "";
    while (Date.now() < until) {
      log = this.log();
      if (log.includes("Call established")) return;
      if (/session closed|call terminated|rejected/.test(log)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${this.name} failed to join the call:\n${log}`);
  }

  /** Save a frame of the video the caller is receiving, as a PNG */
  public snapshot(): Buffer {
    const before = this.snapshots();
    this.command("snapshot");
    const file = this.snapshots().find((f) => !before.includes(f));
    if (file === undefined)
      throw new Error(`${this.name} took no snapshot:\n${this.log()}`);
    return readFileSync(join(this.outDir, file));
  }

  private snapshots(): string[] {
    try {
      return readdirSync(this.outDir).filter((f) =>
        /^snapshot-recv.*\.png$/.test(f),
      );
    } catch {
      return [];
    }
  }

  /** Hang up and stop the container */
  public hangup(): void {
    this.command("quit");
    spawnSync("docker", ["stop", "-t", "5", this.container]);
  }
}
