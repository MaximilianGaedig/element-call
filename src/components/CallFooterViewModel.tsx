/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { supportsBackgroundProcessors } from "@livekit/track-processors";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type MenuOptions } from "./MediaMuteAndSwitchButton";
import { type DeviceLabel, type MediaDevices } from "../state/MediaDevices";
import {
  backgroundBlur as backgroundBlurSettings,
  debugTileLayout as debugTileLayoutSetting,
} from "../settings/settings";
import { type Behavior, computed, constant } from "../state/Behavior";
import { type MuteStates } from "../state/MuteStates";
import { createStaticViewModel, type ViewModel } from "../state/ViewModel";
import { getUrlParams, HeaderStyle } from "../UrlParams";
import { platform } from "../Platform";
import { type FooterSnapshot } from "./CallFooter";

/**
 * Shared helper: maps MuteStates into the audio/video enabled + toggle behaviors
 * needed by FooterSnapshot.
 */
function buildMuteBehaviors(
  muteStates: MuteStates,
): Pick<
  ViewModel<FooterSnapshot>,
  | "audioEnabled$"
  | "audioBusy$"
  | "audioMutedByModerator$"
  | "toggleAudio$"
  | "videoEnabled$"
  | "videoBusy$"
  | "toggleVideo$"
> {
  return {
    audioEnabled$: muteStates.audio.enabled$,
    audioBusy$: muteStates.audio.syncing$,
    audioMutedByModerator$: muteStates.audio.moderatorMuted$,
    toggleAudio$: computed(() => muteStates.audio.toggle$.value ?? undefined),
    videoEnabled$: muteStates.video.enabled$,
    videoBusy$: muteStates.video.syncing$,
    toggleVideo$: computed(() => muteStates.video.toggle$.value ?? undefined),
  };
}

function deviceOptions(
  disabled: boolean,
  available: Map<string, DeviceLabel>,
): MenuOptions[] {
  return disabled
    ? []
    : [...available.entries()].map(([id, label]) => ({ id, label }));
}

/**
 * Shared helper: maps MediaDevices into the audio/video device-list behaviors
 * needed by FooterSnapshot (options, selection, callbacks, blur toggle).
 */
function buildDeviceBehaviors(
  mediaDevices: MediaDevices,
  /** return empty arrays for  audioOptions and videoOptions*/
  disableSwitcher$: Behavior<boolean>,
): Pick<
  ViewModel<FooterSnapshot>,
  | "audioOptions$"
  | "selectedAudio$"
  | "selectAudioButtonOption$"
  | "videoOptions$"
  | "selectedVideo$"
  | "selectVideoButtonOption$"
  | "toggleBlur$"
  | "videoBlurEnabled$"
> {
  return {
    audioOptions$: computed(() =>
      deviceOptions(
        disableSwitcher$.value,
        mediaDevices.audioInput.available$.value,
      ),
    ),
    selectedAudio$: computed(() => mediaDevices.audioInput.selected$.value?.id),
    selectAudioButtonOption$: constant(mediaDevices.audioInput.select),
    videoOptions$: computed(() =>
      deviceOptions(
        disableSwitcher$.value,
        mediaDevices.videoInput.available$.value,
      ),
    ),
    selectedVideo$: computed(() => mediaDevices.videoInput.selected$.value?.id),
    selectVideoButtonOption$: constant(mediaDevices.videoInput.select),
    toggleBlur$: computed(() => {
      const current = backgroundBlurSettings.value$.value;
      return !disableSwitcher$.value && supportsBackgroundProcessors()
        ? (): void => {
            backgroundBlurSettings.setValue(!current);
          }
        : undefined;
    }),
    videoBlurEnabled$: backgroundBlurSettings.value$,
  };
}

/**
 * Creates the ViewModel for the CallFooter.
 *
 * @param callModel - The root CallViewModel; provides layout, grid mode, reactions, etc.
 * @param muteStates - Audio and video mute state + toggles.
 * @param mediaDevices - Available and selected input devices.
 * @param reactionIdentifier - The local user's reaction identifier string, or
 *   undefined when reactions are not supported (hides the reaction button).
 */
export function createCallFooterViewModel(
  callModel: CallViewModel,
  muteStates: MuteStates,
  mediaDevices: MediaDevices,
  reactionIdentifier: string | undefined,
): ViewModel<FooterSnapshot> {
  const { showControls, header: headerStyle } = getUrlParams();
  const showLogo = headerStyle === HeaderStyle.Standard;

  const isPip$ = computed(() => callModel.layout$.value.type === "pip");
  const disableDeviceSwitcher$ = computed(
    () => isPip$.value || platform !== "desktop",
  );

  return {
    ...buildMuteBehaviors(muteStates),
    ...buildDeviceBehaviors(mediaDevices, disableDeviceSwitcher$),

    // candidat to move into the FooterViewModel
    showFooter$: callModel.showFooter$,
    hideControls$: constant(!showControls),
    showModals$: callModel.showModals$,
    asOverlay$: callModel.edgeToEdge$,
    buttonSize$: computed<"md" | "lg">(() => (isPip$.value ? "md" : "lg")),

    openSettings$: computed(() => {
      const setSettingsOpen = callModel.setSettingsOpen$.value;
      return callModel.showModals$.value &&
        headerStyle !== HeaderStyle.AppBar &&
        showControls
        ? (): void => setSettingsOpen(true)
        : undefined;
    }),

    showLogo$: computed(() => showLogo && !isPip$.value),
    layoutSwitchVm$: callModel.layoutSwitchVm$,
    sharingScreen$: callModel.sharingScreen$,
    toggleScreenSharing$: constant(callModel.toggleScreenSharing ?? undefined),
    audioOutputSwitcher$: computed(
      () => callModel.audioOutputSwitcher$.value ?? undefined,
    ),
    hangup$: constant(callModel.hangup),
    reactionIdentifier$: constant(reactionIdentifier),
    reactionData$: constant(
      reactionIdentifier !== undefined
        ? {
            handsRaised$: callModel.handsRaised$,
            reactions$: callModel.reactions$,
          }
        : undefined,
    ),
    debugTileLayout$: debugTileLayoutSetting.value$,
    tileStoreGeneration$: callModel.tileStoreGeneration$,
  };
}

/**
 * Creates a simplified ViewModel for the CallFooter used in the lobby
 * (pre-call) screen. Unlike createCallFooterViewModel, this does not require
 * a CallViewModel — it only needs mute states, device lists, and callbacks.
 *
 * @param muteStates - Audio and video mute state + toggles.
 * @param mediaDevices - Available and selected input devices.
 * @param openSettings - Callback to open the settings modal, or undefined.
 * @param hangup - Callback to leave/cancel, or undefined (hides the button).
 * @param showLogo - Whether to show the Element Call logo.
 */
export function createLobbyFooterViewModel(
  muteStates: MuteStates,
  mediaDevices: MediaDevices,
  openSettings: (() => void) | undefined,
  hangup: (() => void) | undefined,
  showLogo: boolean,
): ViewModel<FooterSnapshot> {
  return {
    ...createStaticViewModel({
      // we can safly skip any props that we do not need.
      // The view model will then have less keys.
      // But as soon as we call `useViewModel` and convert back to a snapshot the missing props will
      // be correcty matching the snapshot type.
      showLogo,
      hideControls: false,
      asOverlay: false,
      showModals: true,
      buttonSize: "lg",
      openSettings,
      hangup,
      debugTileLayout: false,
      showFooter: true,
      toggleAudio: undefined,
      toggleVideo: undefined,
      toggleScreenSharing: undefined,
      audioEnabled: undefined,
      audioBusy: false,
      audioMutedByModerator: false,
      videoEnabled: undefined,
      videoBusy: false,
      layoutSwitchVm: null,
      sharingScreen: false,
      audioOutputSwitcher: undefined,
      reactionIdentifier: undefined,
      reactionData: undefined,
      tileStoreGeneration: undefined,
      audioOptions: undefined,
      videoOptions: undefined,
      selectedAudio: undefined,
      selectedVideo: undefined,
      selectAudioButtonOption: undefined,
      selectVideoButtonOption: undefined,
    }),
    ...buildMuteBehaviors(muteStates),
    ...buildDeviceBehaviors(mediaDevices, constant(false)),
  };
}
