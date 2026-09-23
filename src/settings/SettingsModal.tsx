/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type MatrixClient } from "matrix-js-sdk";
import { Button, Root as Form, Separator, Text } from "@vector-im/compound-web";
import { type Room as LivekitRoom } from "livekit-client";

import { Modal } from "../Modal";
import styles from "./SettingsModal.module.css";
import { type Tab, TabContainer } from "../tabs/Tabs";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import { FeedbackSettingsTab } from "./FeedbackSettingsTab";
import { iosDeviceMenu$ } from "../state/MediaDevices";
import { useMediaDevices } from "../MediaDevicesContext";
import { widget } from "../widget";
import {
  useSetting,
  soundEffectVolume as soundEffectVolumeSetting,
  backgroundBlur as backgroundBlurSetting,
  developerMode,
  cropVideo as cropVideoSetting,
  hugVideo as hugVideoSetting,
  relaxedGrid as relaxedGridSetting,
} from "./settings";
import { PreferencesSettingsTab } from "./PreferencesSettingsTab";
import { DialInAddresses } from "./DialInAddresses";
import { type DialInAddresses as DialInAddressesInfo } from "../state/DialIn";
import { Slider } from "../Slider";
import { DeviceSelection } from "./DeviceSelection";
import { useTrackProcessor } from "../livekit/TrackProcessorContext";
import {
  DeveloperSettingsTab,
  type DeveloperSettingsSnapshot,
} from "./DeveloperSettingsTab";
import { FieldRow, InputField } from "../input/Input";
import { useSubmitRageshake } from "./submit-rageshake";
import { useUrlParams } from "../UrlParams";
import { useBehavior } from "../useBehavior";
import { type ViewModel } from "../state/ViewModel.ts";
import { outOfCallDeveloperSettingsTabViewModel } from "./DeveloperSettingsTabViewModel";

type SettingsTab =
  | "audio"
  | "video"
  | "profile"
  | "preferences"
  | "feedback"
  | "more"
  | "dial_in"
  | "developer";

interface Props {
  open: boolean;
  onDismiss: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  client: MatrixClient;
  roomId?: string;
  livekitRooms?: {
    room: LivekitRoom;
    url: string;
    isLocal?: boolean;
  }[];
  /** Only available while in a call. Used by the developer tab. */
  developerSettingsVm?: ViewModel<DeveloperSettingsSnapshot>;
  /** Addresses for dialling into the call, if a moderator allowed it. */
  dialIn?: DialInAddressesInfo;
}

export const defaultSettingsTab: SettingsTab = "audio";

export const SettingsModal: FC<Props> = ({
  open,
  onDismiss,
  tab,
  onTabChange,
  client,
  roomId,
  livekitRooms,
  developerSettingsVm,
  dialIn,
}) => {
  const { t } = useTranslation();

  // Generate a `Checkbox` input to turn blur on or off.
  const BlurCheckbox: React.FC = (): ReactNode => {
    const { supported } = useTrackProcessor();

    const [blurActive, setBlurActive] = useSetting(backgroundBlurSetting);

    return (
      <>
        <h4>{t("settings.background_blur_header")}</h4>

        <FieldRow>
          <InputField
            id="activateBackgroundBlur"
            label={t("settings.background_blur_label")}
            description={
              supported ? "" : t("settings.blur_not_supported_by_browser")
            }
            type="checkbox"
            checked={!!blurActive}
            onChange={(b): void => setBlurActive(b.target.checked)}
            disabled={!supported}
          />
        </FieldRow>
      </>
    );
  };

  const [hugVideo, setHugVideo] = useSetting(hugVideoSetting);
  const [cropVideo, setCropVideo] = useSetting(cropVideoSetting);
  const [relaxedGrid, setRelaxedGrid] = useSetting(relaxedGridSetting);

  const devices = useMediaDevices();
  useEffect(() => {
    if (open) devices.requestDeviceNames(); // No-op after the first call
  }, [open, devices]);

  const [soundVolume, setSoundVolume] = useSetting(soundEffectVolumeSetting);
  const [soundVolumeRaw, setSoundVolumeRaw] = useState(soundVolume);
  const [showDeveloperSettingsTab] = useSetting(developerMode);

  const { available: isRageshakeAvailable } = useSubmitRageshake();

  // For controlled devices, we will not show the input section:
  // Controlled media devices are used on mobile platforms, where input and output are grouped into
  // a single device. These are called "headset" or "speaker" (or similar) but contain both input and output.
  // On EC, we decided that it is less confusing for the user if they see those options in the output section
  // rather than the input section.
  const { controlledAudioDevices } = useUrlParams();
  // If we are on iOS we will show a button to open the native audio device picker.
  const iosDeviceMenu = useBehavior(iosDeviceMenu$);

  const audioTab: Tab<SettingsTab> = {
    key: "audio",
    name: t("common.audio"),
    content: (
      <>
        <Form>
          {!controlledAudioDevices && (
            <DeviceSelection
              device={devices.audioInput}
              title={t("settings.devices.microphone")}
              numberedLabel={(n) =>
                t("settings.devices.microphone_numbered", { n })
              }
            />
          )}
          {iosDeviceMenu && controlledAudioDevices && (
            <Button
              onClick={(e): void => {
                e.preventDefault();
                window.controls.showNativeAudioDevicePicker?.();
                // call deprecated method for backwards compatibility.
                window.controls.showNativeOutputDevicePicker?.();
              }}
            >
              {t("settings.devices.change_device_button")}
            </Button>
          )}
          <DeviceSelection
            device={devices.audioOutput}
            title={t("settings.devices.speaker")}
            numberedLabel={(n) => t("settings.devices.speaker_numbered", { n })}
          />

          <div className={styles.volumeSlider}>
            <label>
              {t("settings.audio_tab.effect_volume_label")}
              {": "}
              <span className={styles.settingValue}>
                {Math.round(soundVolumeRaw * 100)}%
              </span>
            </label>
            <p>{t("settings.audio_tab.effect_volume_description")}</p>
            <Slider
              label={t("video_tile.volume")}
              value={soundVolumeRaw}
              onValueChange={setSoundVolumeRaw}
              onValueCommit={setSoundVolume}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
        </Form>
      </>
    ),
  };

  const videoTab: Tab<SettingsTab> = {
    key: "video",
    name: t("common.video"),
    content: (
      <>
        <Form>
          <DeviceSelection
            device={devices.videoInput}
            title={t("settings.devices.camera")}
            numberedLabel={(n) => t("settings.devices.camera_numbered", { n })}
          />
        </Form>
        <Separator />
        <BlurCheckbox />
        <Separator />
        <h4>{t("settings.tiles_header")}</h4>
        <FieldRow>
          <InputField
            id="hugVideo"
            label={t("settings.hug_video_label")}
            type="checkbox"
            checked={hugVideo}
            onChange={(e): void => setHugVideo(e.target.checked)}
          />
        </FieldRow>
        <FieldRow>
          <InputField
            id="cropVideo"
            label={t("settings.crop_video_label")}
            type="checkbox"
            checked={cropVideo && !hugVideo}
            onChange={(e): void => setCropVideo(e.target.checked)}
            disabled={hugVideo}
          />
        </FieldRow>
        <FieldRow>
          <InputField
            id="relaxedGrid"
            label={t("settings.relaxed_grid_label")}
            type="checkbox"
            checked={relaxedGrid && hugVideo}
            onChange={(e): void => setRelaxedGrid(e.target.checked)}
            disabled={!hugVideo}
          />
        </FieldRow>
      </>
    ),
  };

  const preferencesTab: Tab<SettingsTab> = {
    key: "preferences",
    name: t("common.preferences"),
    content: <PreferencesSettingsTab />,
  };

  const profileTab: Tab<SettingsTab> = {
    key: "profile",
    name: t("common.profile"),
    content: <ProfileSettingsTab client={client} />,
  };

  const feedbackTab: Tab<SettingsTab> = {
    key: "feedback",
    name: t("settings.feedback_tab_title"),
    content: <FeedbackSettingsTab roomId={roomId} />,
  };

  const developerTab: Tab<SettingsTab> = {
    key: "developer",
    name: t("settings.developer_tab_title"),
    content: (
      <DeveloperSettingsTab
        env={import.meta.env}
        client={client}
        livekitRooms={livekitRooms}
        roomId={roomId}
        vm={developerSettingsVm ?? outOfCallDeveloperSettingsTabViewModel}
      />
    ),
  };

  const dialInTab: Tab<SettingsTab> = {
    key: "dial_in",
    name: t("settings.dial_in.tab_title"),
    content: (
      <>
        <Text>{t("settings.dial_in.introduction")}</Text>
        <DialInAddresses addresses={dialIn ?? { sip: [], phone: [] }} />
      </>
    ),
  };

  const tabs = [audioTab, videoTab];
  if (widget === null) tabs.push(profileTab);
  tabs.push(preferencesTab);
  if (dialIn !== undefined) tabs.push(dialInTab);
  if (isRageshakeAvailable || import.meta.env.VITE_PACKAGE === "full") {
    // for full package we want to show the analytics consent checkbox
    // even if rageshake is not available
    tabs.push(feedbackTab);
  }
  if (showDeveloperSettingsTab) tabs.push(developerTab);

  return (
    <Modal
      title={t("common.settings")}
      className={styles.settingsModal}
      open={open}
      onDismiss={onDismiss}
      tabbed
    >
      <TabContainer
        label={t("common.settings")}
        tab={tab}
        onTabChange={onTabChange}
        tabs={tabs}
      />
    </Modal>
  );
};
