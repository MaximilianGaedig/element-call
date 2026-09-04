/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { type OrderedMember, reconcileOrder } from "./gridOrder";

type Flags = Partial<Omit<OrderedMember<string>, "media">>;

const member = (media: string, flags: Flags = {}): OrderedMember<string> => ({
  media,
  presenting: false,
  handRaised: false,
  speaking: false,
  video: false,
  lastActive: 0,
  ...flags,
});

const order = (
  prev: string[],
  members: OrderedMember<string>[],
  visibleTiles = Infinity,
  spotlight: { entering?: string; leaving?: string } = {},
): string[] => reconcileOrder(prev, { members, visibleTiles, ...spotlight });

describe("reconcileOrder", () => {
  it("puts people with video first when joining", () => {
    expect(
      order(
        [],
        [
          member("me", { pin: "first" }),
          member("a"),
          member("b", { video: true }),
          member("c"),
          member("d", { video: true }),
        ],
      ),
    ).toEqual(["me", "b", "d", "a", "c"]);
  });

  it("inserts joiners with video after the first run of video, others at the end", () => {
    const prev = ["me", "b", "d", "a", "c"];
    const members = [
      member("me", { pin: "first" }),
      member("a"),
      member("b", { video: true }),
      member("c"),
      member("d", { video: true }),
    ];
    expect(order(prev, [...members, member("e", { video: true })])).toEqual([
      "me",
      "b",
      "d",
      "e",
      "a",
      "c",
    ]);
    expect(order(prev, [...members, member("e")])).toEqual([
      "me",
      "b",
      "d",
      "a",
      "c",
      "e",
    ]);
  });

  it("removes people who left, keeping everyone else in place", () => {
    expect(order(["a", "b", "c"], [member("a"), member("c")])).toEqual([
      "a",
      "c",
    ]);
  });

  it("does not reorder when priorities change but everyone is on screen", () => {
    const prev = ["a", "b", "c"];
    expect(
      order(prev, [member("a"), member("b"), member("c", { speaking: true })]),
    ).toBe(prev);
  });

  it("swaps a speaker on screen with whoever has been quiet the longest", () => {
    expect(
      order(
        ["a", "b", "c", "d"],
        [
          member("a", { lastActive: 5 }),
          member("b", { lastActive: 1 }),
          member("c", { lastActive: 3 }),
          member("d", { speaking: true, lastActive: 9 }),
        ],
        3,
      ),
    ).toEqual(["a", "d", "c", "b"]);
  });

  it("does not displace someone with an equal or greater need", () => {
    expect(
      order(
        ["a", "b", "c"],
        [
          member("a", { speaking: true }),
          member("b", { handRaised: true }),
          member("c", { speaking: true }),
        ],
        2,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("brings presenters in ahead of raised hands, ahead of speakers, ahead of video", () => {
    expect(
      order(
        ["a", "b", "c", "d", "e", "f"],
        [
          member("a"),
          member("b"),
          member("c", { video: true }),
          member("d", { speaking: true }),
          member("e", { handRaised: true }),
          member("f", { presenting: true }),
        ],
        2,
      ),
    ).toEqual(["f", "e", "c", "d", "b", "a"]);
  });

  it("brings people with video on screen only if there is room", () => {
    const members = [
      member("a", { video: true }),
      member("b"),
      member("c", { video: true }),
    ];
    expect(order(["a", "b", "c"], members, 2)).toEqual(["a", "c", "b"]);
    expect(
      order(["a", "c", "b"], [...members, member("d", { video: true })], 2),
    ).toEqual(["a", "c", "d", "b"]);
  });

  it("never displaces pinned members, and does not count them as room", () => {
    expect(
      order(
        ["me", "a", "b"],
        [
          member("me", { pin: "first" }),
          member("a"),
          member("b", { speaking: true }),
        ],
        2,
      ),
    ).toEqual(["me", "b", "a"]);
    expect(
      order(
        ["a", "me"],
        [member("me", { pin: "last" }), member("a"), member("b")],
      ),
    ).toEqual(["a", "b", "me"]);
  });

  it("gives the person leaving the spotlight the slot of the person entering it", () => {
    expect(
      order(
        ["me", "b", "c"],
        [member("me"), member("a"), member("c")],
        Infinity,
        {
          entering: "b",
          leaving: "a",
        },
      ),
    ).toEqual(["me", "a", "c"]);
  });
});
