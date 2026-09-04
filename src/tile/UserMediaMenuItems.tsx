/*
Copyright 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BlockIcon,
  LeaveIcon,
  MicOffIcon,
  PinIcon,
  UnpinIcon,
  UserProfileIcon,
  VideoCallOffIcon,
  VisibilityOffIcon,
  VisibilityOnIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import {
  MenuItem,
  Separator,
  Text,
  ToggleMenuItem,
} from "@vector-im/compound-web";

import styles from "./UserMediaMenuItems.module.css";
import { Slider } from "../Slider";
import { useBehavior } from "../useBehavior";
import { useLatest } from "../useLatest";
import { type LocalUserMediaViewModel } from "../state/media/LocalUserMediaViewModel";
import { type RemoteUserMediaViewModel } from "../state/media/RemoteUserMediaViewModel";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";

interface Props {
  vm: UserMediaViewModel;
  /** Opens the local user's profile settings, if that's possible here. */
  onOpenProfile?: (() => void) | null;
  /** Items to put first, such as pinning or enlarging the tile. */
  leading?: ReactNode;
}

/**
 * The items of a user media tile's context menu, wherever the tile is shown.
 */
export const UserMediaMenuItems: FC<Props> = ({
  vm,
  onOpenProfile = null,
  leading,
}) => (
  <>
    {leading}
    {vm.local ? (
      <LocalItems vm={vm} onOpenProfile={onOpenProfile} />
    ) : (
      <RemoteItems vm={vm} />
    )}
  </>
);

const LocalItems: FC<{
  vm: LocalUserMediaViewModel;
  onOpenProfile: (() => void) | null;
}> = ({ vm, onOpenProfile }) => {
  const { t } = useTranslation();
  const alwaysShow = useBehavior(vm.alwaysShow$);
  const latestAlwaysShow = useLatest(alwaysShow);
  const onSelectAlwaysShow = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.setAlwaysShow(!latestAlwaysShow.current);
    },
    [vm, latestAlwaysShow],
  );

  return (
    <>
      <ToggleMenuItem
        Icon={VisibilityOnIcon}
        label={t("video_tile.always_show")}
        checked={alwaysShow}
        onSelect={onSelectAlwaysShow}
      />
      {onOpenProfile && (
        <MenuItem
          Icon={UserProfileIcon}
          label={t("common.profile")}
          onSelect={onOpenProfile}
        />
      )}
    </>
  );
};

const RemoteItems: FC<{ vm: RemoteUserMediaViewModel }> = ({ vm }) => {
  const { t } = useTranslation();
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const playbackVolume = useBehavior(vm.playbackVolume$);
  const moderation = useBehavior(vm.moderation$);
  const moderator = useBehavior(vm.moderator$);
  const memberActions = useBehavior(vm.memberActions$);
  // The volume for everyone as it's being dragged, before it's sent
  const [draftModeratedVolume, setDraftModeratedVolume] = useState<
    number | null
  >(null);
  const onCommitModeratedVolume = useCallback(() => {
    if (draftModeratedVolume !== null) {
      void moderator?.setVolume(draftModeratedVolume);
      setDraftModeratedVolume(null);
    }
  }, [moderator, draftModeratedVolume]);

  const onSelectMute = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.togglePlaybackMuted();
    },
    [vm],
  );

  const VolumeIcon = playbackMuted ? VolumeOffIcon : VolumeOnIcon;

  return (
    <>
      <ToggleMenuItem
        Icon={MicOffIcon}
        label={t("video_tile.mute_for_me")}
        checked={playbackMuted}
        onSelect={onSelectMute}
      />
      {/* TODO: Figure out how to make this slider keyboard accessible */}
      <MenuItem as="div" Icon={VolumeIcon} label={null} onSelect={null}>
        <Slider
          className={styles.volumeSlider}
          label={t("video_tile.volume")}
          value={playbackVolume}
          onValueChange={vm.adjustPlaybackVolume}
          onValueCommit={vm.commitPlaybackVolume}
          min={0}
          max={2}
          step={0.01}
        />
      </MenuItem>
      {/* Non-moderators can at least see that a moderator set the volume */}
      {moderator === null && moderation.volume !== undefined && (
        <MenuItem
          as="div"
          Icon={VolumeOnIcon}
          label={null}
          onSelect={null}
          disabled
        >
          <Slider
            className={styles.volumeSlider}
            label={t("video_tile.volume_for_everyone")}
            value={moderation.volume}
            onValueChange={() => {}}
            min={0}
            max={2}
            step={0.01}
            disabled
          />
        </MenuItem>
      )}
      {(moderator || memberActions) && (
        <>
          <Separator />
          <Text
            as="div"
            size="sm"
            weight="semibold"
            className={styles.menuHeading}
          >
            {t("video_tile.moderator_controls")}
          </Text>
        </>
      )}
      {moderator && (
        <>
          <ToggleMenuItem
            Icon={MicOffIcon}
            label={t("video_tile.mute_audio_for_everyone")}
            checked={moderation.audioMuted}
            onSelect={(e) => {
              e.preventDefault();
              void moderator.setAudioMuted(!moderation.audioMuted);
            }}
          />
          <ToggleMenuItem
            Icon={VideoCallOffIcon}
            label={t("video_tile.mute_video_for_everyone")}
            checked={moderation.videoMuted}
            onSelect={(e) => {
              e.preventDefault();
              void moderator.setVideoMuted(!moderation.videoMuted);
            }}
          />
          <MenuItem
            Icon={moderation.pinned ? UnpinIcon : PinIcon}
            label={
              moderation.pinned
                ? t("video_tile.unpin_for_everyone")
                : t("video_tile.pin_for_everyone")
            }
            onSelect={() => void moderator.setPinned(!moderation.pinned)}
          />
          {/* Once hidden the tile is gone, so unhiding is in Moderator
          settings instead */}
          <MenuItem
            Icon={VisibilityOffIcon}
            label={t("video_tile.hide_for_everyone")}
            onSelect={() => void moderator.setHidden(true)}
          />
          <MenuItem
            Icon={BlockIcon}
            label={t("video_tile.block_from_call")}
            kind="critical"
            onSelect={() => void moderator.setBlocked(true)}
          />
          <MenuItem as="div" Icon={VolumeOnIcon} label={null} onSelect={null}>
            <Slider
              className={styles.volumeSlider}
              label={t("video_tile.volume_for_everyone")}
              value={draftModeratedVolume ?? moderation.volume ?? 1}
              onValueChange={setDraftModeratedVolume}
              onValueCommit={onCommitModeratedVolume}
              min={0}
              max={2}
              step={0.01}
            />
          </MenuItem>
        </>
      )}
      {memberActions && (
        <>
          <MenuItem
            Icon={LeaveIcon}
            label={t("video_tile.kick")}
            kind="critical"
            onSelect={() => void memberActions.kick()}
          />
          <MenuItem
            Icon={BlockIcon}
            label={t("video_tile.ban")}
            kind="critical"
            onSelect={() => void memberActions.ban()}
          />
        </>
      )}
    </>
  );
};
