/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect, vi, beforeAll, afterAll } from "vitest";
import {
  act,
  isInaccessible,
  render,
  screen,
  within,
} from "@testing-library/react";
import { axe } from "vitest-axe";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@vector-im/compound-web";

import { SpotlightTile } from "./SpotlightTile";
import {
  mockLocalParticipant,
  mockMediaDevices,
  mockRtcMembership,
  mockLocalMedia,
  mockRemoteMedia,
  mockRemoteParticipant,
  mockRemoteScreenShare,
} from "../utils/test";
import { SpotlightTileViewModel } from "../state/TileViewModel";
import { type MediaViewModel } from "../state/media/MediaViewModel";
import { constant, state } from "../state/Behavior";
import {
  createRingingMedia,
  type RingingMediaViewModel,
} from "../state/media/RingingMediaViewModel";

// The menu's slider measures itself, which jsdom can't do
global.ResizeObserver = class MockResizeObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
} as unknown as typeof ResizeObserver;

global.IntersectionObserver = class MockIntersectionObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
} as unknown as typeof IntersectionObserver;

// Tiled media are laid out by Grid, which measures its slots: give jsdom a
// ResizeObserver and some size, or no tiles would ever be placed
beforeAll(() => {
  window.ResizeObserver = class ResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
});
afterAll(() => vi.restoreAllMocks());

const aliceAndBob = (): [MediaViewModel, MediaViewModel] => {
  const vm1 = mockRemoteMedia(
    mockRtcMembership("@alice:example.org", "AAAA"),
    {
      rawDisplayName: "Alice",
      getMxcAvatarUrl: () => "mxc://adfsg",
    },
    mockRemoteParticipant({}),
  );

  const vm2 = mockLocalMedia(
    mockRtcMembership("@bob:example.org", "BBBB"),
    {
      rawDisplayName: "Bob",
      getMxcAvatarUrl: () => "mxc://dlskf",
    },
    mockLocalParticipant({}),
    mockMediaDevices({}),
  );
  return [vm1, vm2];
};

test("SpotlightTile shows multiple media side by side", async () => {
  const [vm1, vm2] = aliceAndBob();
  const { container } = render(
    <SpotlightTile
      vm={
        new SpotlightTileViewModel(
          constant([vm1, vm2]),
          constant(false),
          constant("solid"),
        )
      }
      targetWidth={300}
      targetHeight={200}
      expanded={false}
      onToggleExpanded={null}
      showIndicators
      tiled
      showNameTags
      showRingingStatus
      focusable={true}
    />,
  );

  expect(await axe(container)).toHaveNoViolations();
  expect(isInaccessible(screen.getByText("Alice"))).toBe(false);
  expect(isInaccessible(screen.getByText("Bob"))).toBe(false);
  expect(screen.queryByRole("button", { name: "Next" })).toBe(null);
});

test("double-clicking a tiled item enlarges it, and again shrinks it", async () => {
  const [vm1, vm2] = aliceAndBob();
  const { container } = render(
    <SpotlightTile
      vm={
        new SpotlightTileViewModel(
          constant([vm1, vm2]),
          constant(false),
          constant("solid"),
        )
      }
      targetWidth={300}
      targetHeight={200}
      expanded={false}
      onToggleExpanded={null}
      showIndicators
      tiled
      showNameTags
      showRingingStatus
      focusable={true}
    />,
  );
  const user = userEvent.setup();
  // The layout's slot for a tile shares its data-id, but isn't the tile
  const slot = (name: string): Element => {
    const id = (screen.getByText(name).closest("[data-id]") as HTMLElement)
      .dataset.id;
    return container.querySelector(`[data-id="${id}"]:not([data-testid])`)!;
  };
  expect(slot("Alice")).not.toHaveAttribute("data-enlarged");
  await user.dblClick(screen.getByText("Alice"));
  expect(slot("Alice")).toHaveAttribute("data-enlarged");
  expect(slot("Bob")).not.toHaveAttribute("data-enlarged");
  await user.dblClick(screen.getByText("Alice"));
  expect(slot("Alice")).not.toHaveAttribute("data-enlarged");
});

test("SpotlightTile zooms in on one item", async () => {
  const [vm1, vm2] = aliceAndBob();
  const onToggleExpanded = vi.fn();
  const props = {
    vm: new SpotlightTileViewModel(
      constant([vm1, vm2]),
      constant(false),
      constant("solid"),
    ),
    targetWidth: 300,
    targetHeight: 200,
    onToggleExpanded,
    showIndicators: true,
    tiled: true,
    showNameTags: true,
    showRingingStatus: true,
    focusable: true,
  } as const;
  const { rerender } = render(<SpotlightTile {...props} expanded={false} />);

  const user = userEvent.setup();
  // Each item has its own zoom button
  const bob = screen.getByText("Bob").closest("[data-id]") as HTMLElement;
  await user.click(within(bob).getByRole("button", { name: "Expand" }));
  expect(onToggleExpanded).toHaveBeenCalledTimes(1);

  // Once expanded, only the zoomed item is shown, and zooming out collapses
  rerender(<SpotlightTile {...props} expanded />);
  expect(screen.queryByText("Alice")).toBe(null);
  screen.getByText("Bob");
  await user.click(screen.getByRole("button", { name: "Collapse" }));
  expect(onToggleExpanded).toHaveBeenCalledTimes(2);
  rerender(<SpotlightTile {...props} expanded={false} />);
  screen.getByText("Alice");
});

test("SpotlightTile is accessible", async () => {
  const [vm1, vm2] = aliceAndBob();
  const user = userEvent.setup();
  const toggleExpanded = vi.fn();
  const { container } = render(
    <SpotlightTile
      vm={
        new SpotlightTileViewModel(
          constant([vm1, vm2]),
          constant(false),
          constant("solid"),
        )
      }
      targetWidth={300}
      targetHeight={200}
      expanded={false}
      onToggleExpanded={toggleExpanded}
      showIndicators
      showNameTags
      showRingingStatus
      focusable={true}
    />,
  );

  expect(await axe(container)).toHaveNoViolations();
  // Alice should be in the spotlight, with her name and avatar on the
  // first page
  screen.getByText("Alice");
  const aliceAvatar = screen.getByRole("img");
  expect(screen.queryByRole("button", { name: "common.back" })).toBe(null);
  // Bob should be out of the spotlight, and therefore invisible
  expect(isInaccessible(screen.getByText("Bob"))).toBe(true);
  // Now navigate to Bob
  await user.click(screen.getByRole("button", { name: "Next" }));
  screen.getByText("Bob");
  expect(screen.getByRole("img")).not.toBe(aliceAvatar);
  expect(isInaccessible(screen.getByText("Alice"))).toBe(true);
  // Can toggle whether the tile is expanded
  await user.click(screen.getByRole("button", { name: "Expand" }));
  expect(toggleExpanded).toHaveBeenCalled();
});

test("a user in the spotlight has the tile menu", async () => {
  const [vm1] = aliceAndBob();
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <SpotlightTile
        vm={
          new SpotlightTileViewModel(
            constant([vm1]),
            constant(false),
            constant("solid"),
          )
        }
        targetWidth={300}
        targetHeight={200}
        expanded={false}
        onToggleExpanded={null}
        showIndicators
        showNameTags
        showRingingStatus
        focusable={true}
      />
    </TooltipProvider>,
  );

  // The same items as a grid tile's menu, from an options button
  await user.click(screen.getByRole("button", { name: "Options" }));
  screen.getByRole("menuitemcheckbox", { name: "Mute for me" });
});

test("Screen share volume UI is shown when screen share has audio", async () => {
  const vm = mockRemoteScreenShare(
    mockRtcMembership("@alice:example.org", "AAAA"),
    {},
    mockRemoteParticipant({}),
  );

  vi.spyOn(vm, "audioEnabled$", "get").mockReturnValue(constant(true));

  const toggleExpanded = vi.fn();
  const { container } = render(
    <TooltipProvider>
      <SpotlightTile
        vm={
          new SpotlightTileViewModel(
            constant([vm]),
            constant(false),
            constant("solid"),
          )
        }
        targetWidth={300}
        targetHeight={200}
        expanded={false}
        onToggleExpanded={toggleExpanded}
        showIndicators
        showNameTags
        showRingingStatus
        focusable
      />
    </TooltipProvider>,
  );

  expect(await axe(container)).toHaveNoViolations();

  // Volume menu button should exist
  expect(screen.queryByRole("button", { name: /volume/i })).toBeInTheDocument();
});

test("Screen share volume UI is hidden when screen share has no audio", async () => {
  const vm = mockRemoteScreenShare(
    mockRtcMembership("@alice:example.org", "AAAA"),
    {},
    mockRemoteParticipant({}),
  );

  vi.spyOn(vm, "audioEnabled$", "get").mockReturnValue(constant(false));

  const toggleExpanded = vi.fn();
  const { container } = render(
    <SpotlightTile
      vm={
        new SpotlightTileViewModel(
          constant([vm]),
          constant(false),
          constant("solid"),
        )
      }
      targetWidth={300}
      targetHeight={200}
      expanded={false}
      onToggleExpanded={toggleExpanded}
      showIndicators
      showNameTags
      showRingingStatus
      focusable
    />,
  );

  expect(await axe(container)).toHaveNoViolations();

  // Volume menu button should not exist
  expect(
    screen.queryByRole("button", { name: /volume/i }),
  ).not.toBeInTheDocument();
});

test("SpotlightTile displays ringing media", async () => {
  const pickupState$ =
    state<RingingMediaViewModel["pickupState$"]["value"]>("ringing");
  const vm = createRingingMedia({
    pickupState$,
    id: "test",
    intent: "audio",
    userId: "@alice:example.org",
    displayName$: constant("Alice"),
    mxcAvatarUrl$: constant(undefined),
  });

  const toggleExpanded = vi.fn();
  const { container } = render(
    <SpotlightTile
      vm={
        new SpotlightTileViewModel(
          constant([vm]),
          constant(false),
          constant("solid"),
        )
      }
      targetWidth={300}
      targetHeight={200}
      expanded={false}
      onToggleExpanded={toggleExpanded}
      showIndicators
      showNameTags
      showRingingStatus
      focusable={true}
    />,
  );

  expect(await axe(container)).toHaveNoViolations();
  // Alice should be in the spotlight with the right status
  screen.getByText("Alice");
  screen.getByText("Calling…");

  // Now we time out ringing to Alice
  act(() => {
    pickupState$.value = "timeout";
  });
  screen.getByText("Call ended");
});
