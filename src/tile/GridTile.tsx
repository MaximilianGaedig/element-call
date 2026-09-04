/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ComponentProps,
  type FC,
  type ReactNode,
  type Ref,
  useCallback,
  useRef,
  useState,
  useMemo,
} from "react";
import { type animated } from "@react-spring/web";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  MicOnSolidIcon,
  MicOffSolidIcon,
  MicOffIcon,
  OverflowHorizontalIcon,
  VolumeOnIcon,
  VolumeOffIcon,
  VisibilityOnIcon,
  UserProfileIcon,
  VolumeOffSolidIcon,
  SwitchCameraSolidIcon,
  VideoCallOffIcon,
  LeaveIcon,
  BlockIcon,
  PinIcon,
  UnpinIcon,
  ExpandIcon,
  CollapseIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import {
  ContextMenu,
  MenuItem,
  ToggleMenuItem,
  Menu,
  Text,
} from "@vector-im/compound-web";

import styles from "./GridTile.module.css";
import { Slider } from "../Slider";
import { MediaView } from "./MediaView";
import { useLatest } from "../useLatest";
import { type GridTileViewModel } from "../state/TileViewModel";
import { type TileEmphasis } from "../state/CallViewModel/CallViewModel";
import { constant } from "../state/Behavior";
import { useMergedRefs } from "../useMergedRefs";
import { useReactionsSender } from "../reactions/useReactionsSender";
import { useBehavior } from "../useBehavior";
import { type LocalUserMediaViewModel } from "../state/media/LocalUserMediaViewModel";
import { type RemoteUserMediaViewModel } from "../state/media/RemoteUserMediaViewModel";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type RingingMediaViewModel } from "../state/media/RingingMediaViewModel";
import { RingingStatus } from "./RingingStatus";

interface TileProps {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  onDoubleClick?: () => void;
  targetWidth: number;
  targetHeight: number;
  displayName: string;
  mxcAvatarUrl: string | undefined;
  showNameTags: boolean;
  focusable: boolean;
  /** A warning to show prominently on the tile. */
  warning?: string;
  /** What emphasising this tile (double-clicking it) does, if anything. */
  emphasis?: TileEmphasis | null;
  /** Whether the tile currently has that emphasis. */
  emphasised?: boolean;
  onEmphasise?: () => void;
}

interface RingingMediaTileProps extends TileProps {
  vm: RingingMediaViewModel;
  showStatus: boolean;
}

const RingingMediaTile: FC<RingingMediaTileProps> = ({
  vm,
  showStatus,
  className,
  emphasis: _emphasis,
  emphasised: _emphasised,
  onEmphasise,
  ...props
}) => {
  return (
    <MediaView
      className={classNames(className, styles.tile)}
      onDoubleClick={onEmphasise}
      video={undefined}
      userId={vm.userId}
      unencryptedWarning={false}
      status={
        showStatus && (
          <Text as="span" size="sm" weight="medium">
            <RingingStatus vm={vm} />
          </Text>
        )
      }
      avatarStyle="translucent"
      videoEnabled={false}
      mirror={false}
      {...props}
    />
  );
};

interface UserMediaTileProps extends TileProps {
  vm: UserMediaViewModel;
  showSpeakingIndicators: boolean;
  mirror: boolean;
  playbackMuted: boolean;
  waitingForMedia?: boolean;
  primaryButton?: ReactNode;
  focusUrl: string | undefined;
}

/**
 * A user media tile without a context menu.
 */
// The context menu is kept separate from this component for performance
// reasons (c.f. UserMediaTile)
const UserMediaTileInner: FC<UserMediaTileProps & { menu: ReactNode }> = ({
  ref,
  vm,
  showSpeakingIndicators,
  playbackMuted,
  waitingForMedia,
  primaryButton,
  menu,
  className,
  focusUrl,
  displayName,
  mxcAvatarUrl,
  focusable,
  targetWidth,
  targetHeight,
  emphasis: _emphasis,
  emphasised: _emphasised,
  onEmphasise,
  ...props
}) => {
  const { toggleRaisedHand } = useReactionsSender();
  const { t } = useTranslation();
  const video = useBehavior(vm.video$);
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const audioStreamStats = useBehavior(vm.audioStreamStats$);
  const videoStreamStats = useBehavior(vm.videoStreamStats$);
  const audioEnabled = useBehavior(vm.audioEnabled$);
  const videoEnabled = useBehavior(vm.videoEnabled$);
  const speaking = useBehavior(vm.speaking$);

  const rtcBackendIdentity = vm.rtcBackendIdentity;
  const handRaised = useBehavior(vm.handRaised$);
  const handRaisedOrder = useBehavior(vm.handRaisedOrder$);
  const reaction = useBehavior(vm.reaction$);

  const AudioIcon = playbackMuted
    ? VolumeOffSolidIcon
    : audioEnabled
      ? MicOnSolidIcon
      : MicOffSolidIcon;
  const audioIconLabel = playbackMuted
    ? t("video_tile.muted_for_me")
    : audioEnabled
      ? t("microphone_on")
      : t("microphone_off");

  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useMemo(
    () => (
      <button
        aria-label={t("common.options")}
        tabIndex={focusable ? undefined : -1}
      >
        <OverflowHorizontalIcon aria-hidden width={20} height={20} />
      </button>
    ),
    [t, focusable],
  );

  const raisedHandOnClick = useMemo(
    () => (vm.local ? (): void => void toggleRaisedHand() : undefined),
    [vm.local, toggleRaisedHand],
  );

  const showSpeaking = showSpeakingIndicators && speaking;

  return (
    <MediaView
      ref={ref}
      video={video}
      userId={vm.userId}
      unencryptedWarning={unencryptedWarning}
      videoEnabled={videoEnabled}
      className={classNames(className, styles.tile, {
        [styles.speaking]: showSpeaking,
        [styles.handRaised]: !showSpeaking && handRaised,
      })}
      nameTagLeadingIcon={
        <AudioIcon
          width={20}
          height={20}
          aria-label={audioIconLabel}
          data-muted={playbackMuted || !audioEnabled}
          className={styles.muteIcon}
        />
      }
      displayName={displayName}
      mxcAvatarUrl={mxcAvatarUrl}
      focusable={focusable}
      primaryButton={
        primaryButton ?? (
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title={displayName}
            trigger={menuTrigger}
            side="left"
            align="start"
          >
            {menu}
          </Menu>
        )
      }
      raisedHandTime={handRaised ?? undefined}
      raisedHandOrder={handRaisedOrder ?? undefined}
      currentReaction={reaction ?? undefined}
      raisedHandOnClick={raisedHandOnClick}
      waitingForMedia={waitingForMedia}
      focusUrl={focusUrl}
      setVideoAspectRatio={vm.setVideoAspectRatio}
      audioStreamStats={audioStreamStats}
      videoStreamStats={videoStreamStats}
      rtcBackendIdentity={rtcBackendIdentity}
      targetWidth={targetWidth}
      targetHeight={targetHeight}
      onDoubleClick={onEmphasise}
      {...props}
    />
  );
};

/**
 * A user media tile enhanced with a context menu.
 */
const UserMediaTile: FC<
  UserMediaTileProps & { menuStart?: ReactNode; menuEnd?: ReactNode }
> = ({ menuStart, menuEnd, ...props }) => {
  const { t } = useTranslation();
  const { emphasis, emphasised, onEmphasise } = props;
  // The same thing double-clicking the tile does, for the menu
  const emphasiseItem = useMemo(() => {
    if (!emphasis || !onEmphasise) return null;
    const [Icon, label] =
      emphasis === "pin"
        ? emphasised
          ? [UnpinIcon, t("video_tile.unpin")]
          : [PinIcon, t("video_tile.pin")]
        : emphasised
          ? [CollapseIcon, t("video_tile.shrink")]
          : [ExpandIcon, t("video_tile.enlarge")];
    return <MenuItem Icon={Icon} label={label} onSelect={onEmphasise} />;
  }, [t, emphasis, emphasised, onEmphasise]);
  const menu = useMemo(
    () => (
      <>
        {emphasiseItem}
        {menuStart}
        {/*
       No additional menu item (used to be the manual fit to frame.
       Placeholder for future menu items that should be placed here.
       */}
        {menuEnd}
      </>
    ),
    [emphasiseItem, menuStart, menuEnd],
  );

  // ContextMenu is expensive to render, so we avoid subscribing to any
  // frequently-changing behaviors here and instead keep them isolated in the
  // UserMediaTileInner component
  return (
    <ContextMenu
      title={props.displayName}
      trigger={<UserMediaTileInner {...props} menu={menu} />}
      hasAccessibleAlternative
    >
      {menu}
    </ContextMenu>
  );
};

UserMediaTile.displayName = "UserMediaTile";

interface LocalUserMediaTileProps extends TileProps {
  vm: LocalUserMediaViewModel;
  showSpeakingIndicators: boolean;
  onOpenProfile: (() => void) | null;
}

const LocalUserMediaTile: FC<LocalUserMediaTileProps> = ({
  ref,
  vm,
  onOpenProfile,
  focusable,
  ...props
}) => {
  const { t } = useTranslation();
  const mirror = useBehavior(vm.mirror$);
  const alwaysShow = useBehavior(vm.alwaysShow$);
  const switchCamera = useBehavior(vm.switchCamera$);
  const focusUrl = useBehavior(vm.focusUrl$);
  const moderation = useBehavior(vm.moderation$);
  const videoEnabled = useBehavior(vm.videoEnabled$);

  const latestAlwaysShow = useLatest(alwaysShow);
  const onSelectAlwaysShow = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.setAlwaysShow(!latestAlwaysShow.current);
    },
    [vm, latestAlwaysShow],
  );

  const menuStart = useMemo(
    () => (
      <ToggleMenuItem
        Icon={VisibilityOnIcon}
        label={t("video_tile.always_show")}
        checked={alwaysShow}
        onSelect={onSelectAlwaysShow}
      />
    ),
    [t, alwaysShow, onSelectAlwaysShow],
  );
  const menuEnd = useMemo(
    () =>
      onOpenProfile && (
        <MenuItem
          Icon={UserProfileIcon}
          label={t("common.profile")}
          onSelect={onOpenProfile}
        />
      ),
    [t, onOpenProfile],
  );

  return (
    <UserMediaTile
      ref={ref}
      vm={vm}
      playbackMuted={false}
      mirror={mirror}
      primaryButton={
        switchCamera === null ? undefined : (
          <button
            className={styles.switchCamera}
            aria-label={t("switch_camera")}
            onClick={switchCamera}
            tabIndex={focusable ? undefined : -1}
          >
            <SwitchCameraSolidIcon aria-hidden width={20} height={20} />
          </button>
        )
      }
      menuStart={menuStart}
      menuEnd={menuEnd}
      focusable={focusable}
      focusUrl={focusUrl}
      // Our own camera keeps showing to us; the warning is that nobody else
      // sees it, which only matters while it's on
      warning={
        moderation.videoMuted && videoEnabled
          ? t("video_tile.video_muted_by_moderator")
          : undefined
      }
      {...props}
    />
  );
};

LocalUserMediaTile.displayName = "LocalUserMediaTile";

interface RemoteUserMediaTileProps extends TileProps {
  vm: RemoteUserMediaViewModel;
  showSpeakingIndicators: boolean;
}

const RemoteUserMediaTile: FC<RemoteUserMediaTileProps> = ({
  ref,
  vm,
  ...props
}) => {
  const { t } = useTranslation();
  const waitingForMedia = useBehavior(vm.waitingForMedia$);
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const playbackVolume = useBehavior(vm.playbackVolume$);
  const focusUrl = useBehavior(vm.focusUrl$);
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
    <UserMediaTile
      ref={ref}
      vm={vm}
      waitingForMedia={waitingForMedia}
      playbackMuted={playbackMuted}
      mirror={false}
      menuStart={
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
        </>
      }
      menuEnd={
        <>
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
              <MenuItem
                as="div"
                Icon={VolumeOnIcon}
                label={null}
                onSelect={null}
              >
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
      }
      focusUrl={focusUrl}
      {...props}
    />
  );
};

RemoteUserMediaTile.displayName = "RemoteUserMediaTile";

interface GridTileProps {
  ref?: Ref<HTMLDivElement>;
  vm: GridTileViewModel;
  onOpenProfile: (() => void) | null;
  targetWidth: number;
  targetHeight: number;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  showSpeakingIndicators: boolean;
  showNameTags: boolean;
  showRingingStatus: boolean;
  showOutline: boolean;
  focusable: boolean;
  /** What emphasising this tile (double-clicking it) does, if anything. */
  emphasis: TileEmphasis | null;
  onEmphasise: () => void;
}

export const GridTile: FC<GridTileProps> = ({
  ref: theirRef,
  vm,
  showSpeakingIndicators,
  showRingingStatus,
  showOutline,
  onOpenProfile,
  className,
  emphasis,
  ...props
}) => {
  const ourRef = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRefs(ourRef, theirRef);
  const media = useBehavior(vm.media$);
  const displayName = useBehavior(media.displayName$);
  const mxcAvatarUrl = useBehavior(media.mxcAvatarUrl$);
  const enlarged = useBehavior(vm.enlarged$);
  const pinned = useBehavior(
    media.type === "user" ? media.pinned$ : constant(false),
  );
  const emphasised = emphasis === "pin" ? pinned : enlarged;

  if (media.type === "ringing") {
    return (
      <RingingMediaTile
        ref={ref}
        vm={media}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        showStatus={showRingingStatus}
        className={classNames(className, { [styles.outline]: showOutline })}
        emphasis={emphasis}
        emphasised={emphasised}
        {...props}
      />
    );
  } else if (media.local) {
    return (
      <LocalUserMediaTile
        ref={ref}
        vm={media}
        showSpeakingIndicators={showSpeakingIndicators}
        onOpenProfile={onOpenProfile}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        emphasis={emphasis}
        emphasised={emphasised}
        {...props}
      />
    );
  } else {
    return (
      <RemoteUserMediaTile
        ref={ref}
        vm={media}
        showSpeakingIndicators={showSpeakingIndicators}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        emphasis={emphasis}
        emphasised={emphasised}
        {...props}
      />
    );
  }
};

GridTile.displayName = "GridTile";
