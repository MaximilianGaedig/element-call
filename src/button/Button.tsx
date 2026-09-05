/*
Copyright 2022-2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import {
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
  type SVGAttributes,
} from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  Button as CpdButton,
  IconButton,
  Tooltip,
} from "@vector-im/compound-web";
import {
  MicOnSolidIcon,
  MicOffSolidIcon,
  SpinnerIcon,
  VideoCallSolidIcon,
  VideoCallOffSolidIcon,
  EndCallIcon,
  ShareScreenSolidIcon,
  OverflowHorizontalIcon,
  OverflowVerticalIcon,
  AdminIcon,
  VolumeOnSolidIcon,
  VolumeOffSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import styles from "./Button.module.css";
import callFooterStyles from "../components/CallFooter.module.css";
import { platform } from "../Platform";

/**
 * A tooltip around a button that may be disabled. Disabled buttons don't
 * receive pointer events, so when there's a reason for the disabling to
 * explain, the tooltip listens on a wrapper instead.
 */
const DisableableTooltip: FC<{
  label: string;
  disabledReason: string | undefined;
  children: ReactNode;
}> = ({ label, disabledReason, children }) =>
  disabledReason === undefined ? (
    <Tooltip label={label}>{children}</Tooltip>
  ) : (
    <Tooltip label={disabledReason}>
      <span className={styles.disabledWrapper}>{children}</span>
    </Tooltip>
  );

interface MicButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  busy?: boolean;
  size?: "md" | "lg";
  /** Why the button is disabled, if it is; shown in its tooltip */
  disabledReason?: string;
}

export const MicButton: FC<MicButtonProps> = ({
  enabled,
  busy,
  disabledReason,
  ...props
}) => {
  const { t } = useTranslation();
  const Icon = busy ? SpinnerIcon : enabled ? MicOnSolidIcon : MicOffSolidIcon;
  const label = enabled
    ? t("mute_microphone_button_label")
    : t("unmute_microphone_button_label");

  return (
    <DisableableTooltip label={label} disabledReason={disabledReason}>
      <CpdButton
        iconOnly
        Icon={Icon}
        kind={enabled ? "secondary" : "primary"}
        role="switch"
        aria-checked={enabled}
        {...props}
        aria-busy={busy}
        className={classNames(props.className, {
          [styles.rotate]: !!busy,
        })}
        disabled={props.disabled || busy}
      />
    </DisableableTooltip>
  );
};

interface VideoButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  busy?: boolean;
  size?: "md" | "lg";
  /** Why the button is disabled, if it is; shown in its tooltip */
  disabledReason?: string;
}

export const VideoButton: FC<VideoButtonProps> = ({
  enabled,
  busy,
  disabledReason,
  ...props
}) => {
  const { t } = useTranslation();
  const Icon = busy
    ? SpinnerIcon
    : enabled
      ? VideoCallSolidIcon
      : VideoCallOffSolidIcon;
  const label = enabled
    ? t("stop_video_button_label")
    : t("start_video_button_label");

  return (
    <DisableableTooltip label={label} disabledReason={disabledReason}>
      <CpdButton
        iconOnly
        Icon={Icon}
        kind={enabled ? "secondary" : "primary"}
        role="switch"
        aria-checked={enabled}
        {...props}
        aria-busy={busy}
        className={classNames(props.className, {
          [styles.rotate]: !!busy,
        })}
        disabled={props.disabled || busy}
      />
    </DisableableTooltip>
  );
};

interface ShareScreenButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  size: "md" | "lg";
}

export const ShareScreenButton: FC<ShareScreenButtonProps> = ({
  enabled,
  ...props
}) => {
  const { t } = useTranslation();
  const label = enabled
    ? t("stop_screenshare_button_label")
    : t("screenshare_button_label");

  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={ShareScreenSolidIcon}
        kind={enabled ? "primary" : "secondary"}
        role="switch"
        aria-checked={enabled}
        {...props}
      />
    </Tooltip>
  );
};

const RecordIcon: FC<SVGAttributes<SVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <circle className={styles.recordDot} cx="12" cy="12" r="4" />
  </svg>
);

interface RecordButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
  /** Whether the call is being recorded, which fills the dot */
  recording: boolean;
}

export const RecordButton: FC<RecordButtonProps> = ({
  recording,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  const label = recording
    ? t("recording.stop_button_label")
    : t("recording.start_button_label");
  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={RecordIcon}
        kind="secondary"
        role="switch"
        aria-checked={recording}
        className={classNames(className, { [styles.recording]: recording })}
        {...props}
      />
    </Tooltip>
  );
};

interface EndCallButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
}

export const EndCallButton: FC<EndCallButtonProps> = (props) => {
  const { t } = useTranslation();

  return (
    <Tooltip label={t("hangup_button_label")}>
      <CpdButton iconOnly Icon={EndCallIcon} destructive {...props} />
    </Tooltip>
  );
};

interface LoudspeakerButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
  loudspeakerModeEnabled: boolean;
}
export const LoudspeakerButton: FC<LoudspeakerButtonProps> = ({
  loudspeakerModeEnabled,
  ...props
}) => {
  const { t } = useTranslation();
  // if the target is the earpice, we are currently in loudspeaker mode.
  const label = loudspeakerModeEnabled
    ? t("settings.devices.loudspeaker")
    : t("settings.devices.handset");
  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={loudspeakerModeEnabled ? VolumeOnSolidIcon : VolumeOffSolidIcon}
        {...props}
        kind={loudspeakerModeEnabled ? "secondary" : "primary"}
        aria-checked={loudspeakerModeEnabled}
      />
    </Tooltip>
  );
};

function classNamesForScreenWidth(
  className?: string,
  forScreenWidth?: "wide" | "narrow",
): string {
  return classNames(className, {
    [callFooterStyles.settingsOnlyShowWide]: forScreenWidth === "wide",
    [callFooterStyles.settingsOnlyShowNarrow]: forScreenWidth === "narrow",
  });
}

interface SettingsIconButtonProps extends ComponentPropsWithoutRef<"button"> {
  /** If this buttons should be setup to be used in the app bar */
  showForScreenWidth?: "wide" | "narrow";
  kind?: "secondary" | "primary";
}
export const SettingsIconButton: FC<SettingsIconButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  const Icon =
    platform === "android" ? OverflowVerticalIcon : OverflowHorizontalIcon;
  return (
    <Tooltip label={t("common.settings")}>
      <IconButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        {...props}
      >
        <Icon aria-hidden />
      </IconButton>
    </Tooltip>
  );
};

/**
 * Opens the moderator settings; shown only to moderators, so it also marks
 * the local user as one.
 */
export const ModeratorIconButton: FC<SettingsIconButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t("settings.moderator_settings")}>
      <IconButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        {...props}
      >
        <AdminIcon aria-hidden />
      </IconButton>
    </Tooltip>
  );
};

interface SettingsButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
  /** If this buttons should be setup to be used in the app bar */
  showForScreenWidth?: "wide" | "narrow";
}
export const SettingsButton: FC<SettingsButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t("common.settings")}>
      <CpdButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        iconOnly
        Icon={
          platform === "android" ? OverflowVerticalIcon : OverflowHorizontalIcon
        }
        kind={"secondary"}
        {...props}
      />
    </Tooltip>
  );
};

export const ModeratorButton: FC<SettingsButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t("settings.moderator_settings")}>
      <CpdButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        iconOnly
        Icon={AdminIcon}
        kind={"secondary"}
        {...props}
      />
    </Tooltip>
  );
};
