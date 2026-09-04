/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type LayoutMode } from "./LayoutSwitchViewModel.ts";
import { type OrderedMember } from "./gridOrder.ts";
import {
  type GridLayoutMedia,
  type LayoutMedia,
  type OneOnOneDesktopLayoutMedia,
  type OneOnOneMobileLayoutMedia,
  type SpotlightExpandedLayoutMedia,
  type SpotlightLandscapeLayoutMedia,
  type SpotlightPortraitLayoutMedia,
} from "./layout-types.ts";
import { type LocalUserMediaViewModel } from "./media/LocalUserMediaViewModel.ts";
import { type MediaViewModel } from "./media/MediaViewModel.ts";
import { type RingingMediaViewModel } from "./media/RingingMediaViewModel.ts";
import { type ScreenShareViewModel } from "./media/ScreenShareViewModel.ts";
import { type UserMediaViewModel } from "./media/UserMediaViewModel.ts";
import { type WindowMode } from "./CallViewModel/CallViewModel.ts";

// Pure functions deciding what the call layout shows. They take plain values
// and return plain values, so they can be unit tested without any reactive
// machinery; CallViewModel wires them up to Behaviors.

/** Calls with more people than this get a spotlight in narrow windows. */
const smallMobileCallThreshold = 3;

/**
 * Picks who to spotlight based on who is speaking, preferring the previous
 * pick so that the spotlight doesn't flip eagerly between speakers.
 *
 * @param prev The previous pick, if any.
 * @param items All user media in the call along with whether each is speaking.
 * @param fallback Whether to spotlight somebody arbitrary when nobody has
 *   spoken. The spotlight shouldn't be empty on its own, but if pinned users
 *   are already filling it there's no need to pull in a random extra person.
 */
export function chooseSpotlightSpeaker<M extends { local: boolean }>(
  prev: M | undefined,
  items: readonly { media: M; speaking: boolean }[],
  fallback = true,
): M | undefined {
  // Only remote users that are still in the call should be sticky
  const sticky = items.find((i) => i.media === prev && !i.media.local);
  // If the previous speaker is still speaking, stick with them
  if (sticky?.speaking) return sticky.media;
  return (
    // Otherwise, select any remote user who is speaking
    items.find((i) => !i.media.local && i.speaking)?.media ??
    // Otherwise, stick with the person who was last speaking
    sticky?.media ??
    (fallback
      ? // Otherwise, spotlight an arbitrary remote user
        (items.find((i) => !i.media.local)?.media ??
        // Otherwise, spotlight the local user
        items.find((i) => i.media.local)?.media)
      : undefined)
  );
}

export interface SpotlightInputs {
  ringing: RingingMediaViewModel | null;
  screenShares: ScreenShareViewModel[];
  speaker: UserMediaViewModel | undefined;
  /** Users the local user has pinned to the spotlight. */
  pinned: UserMediaViewModel[];
  /** Local user media suitable for showing in a PiP, if any. */
  localPip: UserMediaViewModel | undefined;
}

/**
 * Decides what goes in the spotlight, and what goes in the picture-in-picture
 * tile of the expanded spotlight layout. Pinned users come after whatever
 * would be there anyway.
 */
export function computeSpotlight({
  ringing,
  screenShares,
  speaker,
  pinned,
  localPip,
}: SpotlightInputs): {
  spotlight: MediaViewModel[];
  pip: UserMediaViewModel | undefined;
} {
  if (ringing !== null) return { spotlight: [ringing], pip: localPip };
  if (screenShares.length > 0)
    return { spotlight: [...screenShares, ...pinned], pip: speaker };
  const spotlight: MediaViewModel[] = speaker ? [speaker] : [];
  for (const m of pinned) if (!spotlight.includes(m)) spotlight.push(m);
  return {
    spotlight,
    // Hide PiP if redundant (i.e. if local user is already in spotlight)
    pip:
      localPip !== undefined && spotlight.includes(localPip)
        ? undefined
        : localPip,
  };
}

export interface OneOnOneMedia {
  local: LocalUserMediaViewModel;
  remote: UserMediaViewModel | RingingMediaViewModel;
}

export interface LayoutMediaInputs {
  windowMode: WindowMode;
  /** The layout chosen with the layout switch. */
  layoutMode: LayoutMode;
  spotlightExpanded: boolean;
  /** Set when the call qualifies for a one-on-one layout. */
  oneOnOne: OneOnOneMedia | null;
  localVideoEnabled: boolean;
  spotlight: MediaViewModel[];
  grid: OrderedMember<UserMediaViewModel>[];
  pip: UserMediaViewModel | undefined;
  desktop: boolean;
}

/**
 * Decides which layout to use and which media goes where in it.
 */
export function computeLayoutMedia({
  windowMode,
  layoutMode,
  spotlightExpanded,
  oneOnOne,
  localVideoEnabled,
  spotlight,
  grid,
  pip,
  desktop,
}: LayoutMediaInputs): LayoutMedia {
  const hasScreenShare = spotlight.some((vm) => vm.type === "screen share");
  const gridLayout = (): GridLayoutMedia => ({
    type: "grid",
    edgeToEdge: false,
    spotlight: hasScreenShare ? spotlight : undefined,
    grid,
  });
  const spotlightLandscape = (
    edgeToEdge: boolean,
  ): SpotlightLandscapeLayoutMedia => ({
    type: "spotlight-landscape",
    edgeToEdge,
    spotlight,
    grid,
  });
  const spotlightPortrait = (): SpotlightPortraitLayoutMedia => ({
    type: "spotlight-portrait",
    edgeToEdge: false,
    spotlight,
    grid,
  });
  const spotlightExpandedLayout = (
    edgeToEdge: boolean,
  ): SpotlightExpandedLayoutMedia => ({
    type: "spotlight-expanded",
    edgeToEdge,
    spotlight,
    pip,
  });
  const oneOnOneDesktop = (media: OneOnOneMedia): OneOnOneDesktopLayoutMedia =>
    media.remote.type === "ringing"
      ? {
          type: "one-on-one-desktop",
          edgeToEdge: false,
          spotlight: media.local,
          pip: media.remote,
        }
      : {
          type: "one-on-one-desktop",
          edgeToEdge: false,
          spotlight: media.remote,
          pip: media.local,
        };
  const oneOnOneMobile = (media: OneOnOneMedia): OneOnOneMobileLayoutMedia => ({
    type: "one-on-one-mobile",
    edgeToEdge: true,
    spotlight: media.remote,
    pip: localVideoEnabled ? media.local : undefined,
  });

  switch (windowMode) {
    case "normal":
      if (layoutMode === "grid")
        return oneOnOne === null ? gridLayout() : oneOnOneDesktop(oneOnOne);
      return spotlightExpanded
        ? spotlightExpandedLayout(false)
        : spotlightLandscape(false);
    case "narrow":
      if (oneOnOne !== null) return oneOnOneMobile(oneOnOne);
      return grid.length > smallMobileCallThreshold || hasScreenShare
        ? spotlightPortrait()
        : gridLayout();
    case "flat":
      if (oneOnOne !== null) return oneOnOneMobile(oneOnOne);
      // Yes, grid mode actually gets you a "spotlight" layout in this window
      // mode.
      return layoutMode === "grid"
        ? spotlightLandscape(true)
        : spotlightExpandedLayout(true);
    case "pip":
      return { type: "pip", edgeToEdge: !desktop, spotlight };
  }
}
