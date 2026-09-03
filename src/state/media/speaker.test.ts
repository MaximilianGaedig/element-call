/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, test } from "vitest";

import { withTestScheduler } from "../../utils/test";
import { speaker$ } from "./speaker";

const yesNo = {
  y: true,
  n: false,
};

function speakerTest(speakingMarbles: string, expectedMarbles: string): void {
  withTestScheduler(({ scope, behavior, expectObservable }) => {
    expectObservable(speaker$(scope, behavior(speakingMarbles, yesNo))).toBe(
      expectedMarbles,
      yesNo,
    );
  });
}

describe("speaker$", () => {
  describe("does not activate", () => {
    test("after no speaking", () => {
      speakerTest("n", "n");
    });

    test("with speaking for 1ms", () => {
      speakerTest("y n", "n");
    });

    test("with speaking for 999ms", () => {
      speakerTest("y 999ms n", "n");
    });

    test("with speaking intermittently", () => {
      speakerTest(
        "y 199ms n 199ms y 199ms n 199ms y 199ms n 199ms y 199ms n 199ms y 199ms n 199ms y 199ms n 199ms y 199ms n 199ms y 199ms n",
        "n",
      );
    });

    test("with consecutive speaking then stops speaking", () => {
      speakerTest("y y y y y y y y y y n", "n");
    });
  });

  describe("activates", () => {
    test("after 1s", () => {
      // this will activate after 1s as no `n` follows it:
      speakerTest(" y", "n 999ms y");
    });

    test("speaking for 1001ms activates for 60s", () => {
      speakerTest(" y 1s    n      ", "n 999ms y 60s n");
    });

    test("speaking for 5s activates for 64s", () => {
      speakerTest(" y 5s    n      ", "n 999ms y 64s n");
    });
  });
});
