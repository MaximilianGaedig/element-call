/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type SVGAttributes, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button as CpdButton,
  Menu,
  MenuItem,
  ToggleMenuItem,
} from "@vector-im/compound-web";
import {
  AdminIcon,
  OverflowHorizontalIcon,
  RaisedHandSolidIcon,
  ReactionSolidIcon,
  SettingsSolidIcon,
  ShareScreenSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { CaptionsIcon, type ReactionData, useReactionsPopup } from "../button";

interface Props {
  className?: string;
  size?: "md" | "lg";
  openSettings?: () => void;
  openModeratorSettings?: () => void;
  sharingScreen?: boolean;
  toggleScreenSharing?: () => void;
  recording?: boolean;
  toggleRecording?: () => void;
  captions?: boolean;
  toggleCaptions?: () => void;
  reactions?: { identifier: string; reactionData: ReactionData };
}

/**
 * A "…" button for footers too narrow to show every button, whose menu holds
 * the ones the footer hides: settings, screen sharing, recording, reactions.
 */
export const MoreButton: FC<Props> = ({ reactions, ...props }) =>
  reactions === undefined ? (
    <MoreMenu {...props} />
  ) : (
    <MoreButtonWithReactions {...props} reactions={reactions} />
  );

// The reactions hooks need a ReactionsProvider, which the lobby lacks
const MoreButtonWithReactions: FC<
  Omit<Props, "reactions"> & { reactions: NonNullable<Props["reactions"]> }
> = ({ reactions, ...props }) => {
  // The popup outlives the menu, which unmounts its items on close
  const popup = useReactionsPopup(reactions.identifier, reactions.reactionData);
  return (
    <>
      <MoreMenu
        {...props}
        reactionsItem={{
          Icon: popup.isHandRaised ? RaisedHandSolidIcon : ReactionSolidIcon,
          disabled: popup.busy,
          open: () => popup.setOpen(true),
        }}
      />
      {popup.modal}
    </>
  );
};

const MoreMenu: FC<
  Omit<Props, "reactions"> & {
    reactionsItem?: {
      Icon: FC<SVGAttributes<SVGElement>>;
      disabled: boolean;
      open: () => void;
    };
  }
> = ({
  className,
  size,
  openSettings,
  openModeratorSettings,
  sharingScreen,
  toggleScreenSharing,
  recording,
  toggleRecording,
  captions,
  toggleCaptions,
  reactionsItem,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Menu
      title={t("common.more")}
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      trigger={
        <CpdButton
          className={className}
          size={size}
          iconOnly
          Icon={OverflowHorizontalIcon}
          kind="secondary"
          aria-label={t("common.more")}
          data-testid="incall_more"
        />
      }
    >
      {openSettings !== undefined && (
        <MenuItem
          Icon={SettingsSolidIcon}
          label={t("common.settings")}
          onSelect={openSettings}
          hideChevron
        />
      )}
      {openModeratorSettings !== undefined && (
        <MenuItem
          Icon={AdminIcon}
          label={t("settings.moderator_settings")}
          onSelect={openModeratorSettings}
          hideChevron
        />
      )}
      {toggleScreenSharing !== undefined && (
        <ToggleMenuItem
          Icon={ShareScreenSolidIcon}
          label={t("screenshare_button_label")}
          checked={sharingScreen ?? false}
          onSelect={toggleScreenSharing}
        />
      )}
      {toggleRecording !== undefined && (
        <ToggleMenuItem
          Icon={RecordMenuIcon}
          label={t("recording.start_button_label")}
          checked={recording ?? false}
          onSelect={toggleRecording}
        />
      )}
      {toggleCaptions !== undefined && (
        <ToggleMenuItem
          Icon={CaptionsIcon}
          label={t("captions.start_button_label")}
          checked={captions ?? false}
          onSelect={toggleCaptions}
        />
      )}
      {reactionsItem !== undefined && (
        <MenuItem
          Icon={reactionsItem.Icon}
          label={t("common.reactions")}
          disabled={reactionsItem.disabled}
          onSelect={reactionsItem.open}
          hideChevron
        />
      )}
    </Menu>
  );
};

const RecordMenuIcon: FC<SVGAttributes<SVGElement>> = (props) => (
  <svg viewBox="0 0 20 20" fill="none" {...props}>
    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
    <circle cx="10" cy="10" r="4" fill="currentColor" />
  </svg>
);
