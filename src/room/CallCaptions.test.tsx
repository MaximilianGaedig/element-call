/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { type MatrixEvent } from "matrix-js-sdk";

import { state } from "../state/Behavior";
import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type Caption } from "../state/Transcription";

// The shared components measure themselves, which jsdom can't
vi.stubGlobal(
  "ResizeObserver",
  class {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  },
);
// jsdom has no scrolling
Element.prototype.scrollTo = vi.fn();
const { CallCaptions, Segment, i18n } = await import("./CallCaptions");
const { I18nContext } = await import("@element-hq/web-shared-components");

function segment(
  id: string,
  body: string,
  speaker?: string,
  ts = 1_700_000_000_000,
): Caption {
  const event = {
    getId: () => id,
    getTs: () => ts,
    getContent: () => ({ msgtype: "m.notice", body }),
  } as unknown as MatrixEvent;
  return { event, body, speaker };
}

test("CallCaptions shows the transcript as it arrives", () => {
  const segments$ = state<Caption[]>([]);
  const listening$ = state(false);
  const vm = {
    transcription: { segments$, listening$ },
  } as unknown as CallViewModel;
  render(<CallCaptions vm={vm} />);
  screen.getByText("Waiting for the transcriber…");
  // The transcriber is in, and nobody has said anything yet
  act(() => {
    listening$.value = true;
  });
  screen.getByText("Listening…");

  act(() => {
    segments$.value = [segment("$1", "Alice: hello there")];
  });
  screen.getByText("hello there");
  expect(screen.queryByText("Listening…")).toBeNull();
  // Alice's next words within a few seconds join her first
  act(() => {
    segments$.value = [
      ...segments$.value,
      segment("$2", "Alice: and more", undefined, 1_700_000_001_000),
      segment("$3", "Bob: hi", undefined, 1_700_000_002_000),
      segment("$4", "Bob: later", undefined, 1_700_000_009_000),
    ];
  });
  screen.getByText("and more");
  expect(screen.getAllByText("Alice")).toHaveLength(1);
  expect(screen.getAllByText("Bob")).toHaveLength(2);
});

test("CallCaptions lets the user read back, and jump to the latest", () => {
  const segments$ = state<Caption[]>([segment("$1", "Alice: hello")]);
  const vm = {
    transcription: { segments$, listening$: state(true) },
  } as unknown as CallViewModel;
  render(<CallCaptions vm={vm} />);
  const list = screen.getByRole("list");
  const scrollTo = vi.fn();
  Object.assign(list, { scrollTo });
  const geometry = (scrollTop: number): void => {
    for (const [k, value] of Object.entries({
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop,
    }))
      Object.defineProperty(list, k, { value, configurable: true });
  };

  // At the bottom, new words are followed
  geometry(400);
  fireEvent.scroll(list);
  act(() => {
    segments$.value = [...segments$.value, segment("$2", "Bob: hi")];
  });
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Jump to latest")).toBeNull();

  // Scrolled up, they aren't, and there's a way back down
  geometry(100);
  fireEvent.scroll(list);
  act(() => {
    segments$.value = [...segments$.value, segment("$3", "Bob: more")];
  });
  expect(scrollTo).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Jump to latest"));
  expect(scrollTo).toHaveBeenCalledTimes(2);
});

test("CallCaptions resizes from its top edge", () => {
  const vm = {
    transcription: { segments$: state([]), listening$: state(true) },
  } as unknown as CallViewModel;
  render(<CallCaptions vm={vm} />);
  const section = screen.getByRole("region");
  section.getBoundingClientRect = (): DOMRect =>
    ({ height: 120 }) as unknown as DOMRect;
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowUp" });
  expect(section.style.getPropertyValue("--captions-height")).toBe("140px");
});

test("Segment shows the speaker as the sender", () => {
  render(
    <I18nContext.Provider value={i18n}>
      <Segment {...segment("$1", "Alice: hello there")} />
    </I18nContext.Provider>,
  );
  screen.getByText("Alice");
  screen.getByText("hello there");
});

test("Segment prefers the speaker the bot named", () => {
  render(
    <I18nContext.Provider value={i18n}>
      <Segment {...segment("$1", "Alice: hello there", "Alice Smith")} />
    </I18nContext.Provider>,
  );
  screen.getByText("Alice Smith");
  screen.getByText("hello there");
});

test("Segment shows an unattributed line as it is", () => {
  render(
    <I18nContext.Provider value={i18n}>
      <Segment {...segment("$1", "hello there")} />
    </I18nContext.Provider>,
  );
  screen.getByText("hello there");
});
