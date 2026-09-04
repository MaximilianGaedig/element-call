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
  OverflowHorizontalIcon,
  VolumeOffSolidIcon,
  SwitchCameraSolidIcon,
  PinIcon,
  ExpandIcon,
  CollapseIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import {
  ContextMenu,
  MenuItem,
  Menu,
  Text,
  ToggleMenuItem,
} from "@vector-im/compound-web";

import styles from "./GridTile.module.css";
import { MediaView } from "./MediaView";
import { type GridTileViewModel } from "../state/TileViewModel";
import { constant } from "../state/Behavior";
import { useMergedRefs } from "../useMergedRefs";
import { useReactionsSender } from "../reactions/useReactionsSender";
import { useBehavior } from "../useBehavior";
import { type LocalUserMediaViewModel } from "../state/media/LocalUserMediaViewModel";
import { type RemoteUserMediaViewModel } from "../state/media/RemoteUserMediaViewModel";
import { UserMediaMenuItems } from "./UserMediaMenuItems";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type RingingMediaViewModel } from "../state/media/RingingMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
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
  /** Whether double-clicking this tile enlarges or shrinks it. */
  enlargeable?: boolean;
  enlarged?: boolean;
  onToggleEnlarged?: () => void;
  /** Pins or unpins the tile from its menu. */
  onTogglePin?: () => void;
}

interface RingingMediaTileProps extends TileProps {
  vm: RingingMediaViewModel;
  showStatus: boolean;
}

const RingingMediaTile: FC<RingingMediaTileProps> = ({
  vm,
  showStatus,
  className,
  enlargeable: _enlargeable,
  enlarged: _enlarged,
  onToggleEnlarged,
  onTogglePin: _onTogglePin,
  ...props
}) => {
  return (
    <MediaView
      className={classNames(className, styles.tile)}
      onDoubleClick={onToggleEnlarged}
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
  enlargeable: _enlargeable,
  enlarged: _enlarged,
  onToggleEnlarged,
  onTogglePin: _onTogglePin,
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
  const pinned = useBehavior(vm.pinned$);
  const isModerator = useBehavior(vm.isModerator$);

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
  // Moderators are shown which tiles they've applied floor control to
  const moderator = useBehavior(vm.moderator$);
  const moderation = useBehavior(vm.moderation$);
  const moderated = moderator !== null && moderation.explicit;
  const menuTrigger = useMemo(
    () => (
      <button
        aria-label={t("common.options")}
        tabIndex={focusable ? undefined : -1}
        data-moderated={moderated || undefined}
      >
        <OverflowHorizontalIcon aria-hidden width={20} height={20} />
      </button>
    ),
    [t, focusable, moderated],
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
      pinned={pinned}
      moderator={isModerator}
      mxcAvatarUrl={mxcAvatarUrl}
      focusable={focusable}
      primaryButton={
        primaryButton ?? (
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title={`${displayName} (${vm.userId})`}
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
      onDoubleClick={onToggleEnlarged}
      {...props}
    />
  );
};

/**
 * A user media tile enhanced with a context menu.
 */
const UserMediaTile: FC<
  UserMediaTileProps & { onOpenProfile?: (() => void) | null }
> = ({ onOpenProfile = null, ...props }) => {
  const { t } = useTranslation();
  const { enlargeable, enlarged, onToggleEnlarged, onTogglePin } = props;
  const pinned = useBehavior(props.vm.pinned$);
  // The same thing double-clicking the tile does, for the menu
  const enlargeItem = useMemo(() => {
    if (!enlargeable || !onToggleEnlarged) return null;
    const [Icon, label] = enlarged
      ? [CollapseIcon, t("video_tile.shrink")]
      : [ExpandIcon, t("video_tile.enlarge")];
    return <MenuItem Icon={Icon} label={label} onSelect={onToggleEnlarged} />;
  }, [t, enlargeable, enlarged, onToggleEnlarged]);
  const pinItem = useMemo(
    () =>
      onTogglePin && (
        <ToggleMenuItem
          Icon={PinIcon}
          label={t("video_tile.pin")}
          checked={pinned}
          onSelect={(e) => {
            e.preventDefault();
            onTogglePin();
          }}
        />
      ),
    [t, onTogglePin, pinned],
  );
  const menu = useMemo(
    () => (
      <UserMediaMenuItems
        vm={props.vm}
        onOpenProfile={onOpenProfile}
        leading={
          <>
            {enlargeItem}
            {pinItem}
          </>
        }
      />
    ),
    [props.vm, onOpenProfile, enlargeItem, pinItem],
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
  const switchCamera = useBehavior(vm.switchCamera$);
  const focusUrl = useBehavior(vm.focusUrl$);
  const moderation = useBehavior(vm.moderation$);
  const videoEnabled = useBehavior(vm.videoEnabled$);

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
      onOpenProfile={onOpenProfile}
      focusable={focusable}
      focusUrl={focusUrl}
      // Our own camera keeps showing to us; the warning is that nobody else
      // sees it, which only matters while it's on. Being hidden altogether
      // matters regardless.
      warning={
        moderation.hidden
          ? t("video_tile.hidden_by_moderator")
          : moderation.videoMuted && videoEnabled
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
  const waitingForMedia = useBehavior(vm.waitingForMedia$);
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const focusUrl = useBehavior(vm.focusUrl$);

  return (
    <UserMediaTile
      ref={ref}
      vm={vm}
      waitingForMedia={waitingForMedia}
      playbackMuted={playbackMuted}
      mirror={false}
      focusUrl={focusUrl}
      {...props}
    />
  );
};

RemoteUserMediaTile.displayName = "RemoteUserMediaTile";

interface ScreenShareTileProps extends TileProps {
  vm: ScreenShareViewModel;
}

// A local share has no videoEnabled$ (we always send it), so its tile reads
// this instead of making a fresh signal on every render
const alwaysEnabled$ = constant(true);

const ScreenShareTile: FC<ScreenShareTileProps> = ({
  vm,
  className,
  enlargeable: _enlargeable,
  enlarged: _enlarged,
  onToggleEnlarged,
  onTogglePin: _onTogglePin,
  ...props
}) => {
  const video = useBehavior(vm.video$);
  const videoEnabled = useBehavior(
    vm.local ? alwaysEnabled$ : vm.videoEnabled$,
  );
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const focusUrl = useBehavior(vm.focusUrl$);

  return (
    <MediaView
      className={classNames(className, styles.tile)}
      onDoubleClick={onToggleEnlarged}
      video={video ?? undefined}
      videoFit="contain"
      userId={vm.userId}
      videoEnabled={videoEnabled}
      unencryptedWarning={unencryptedWarning}
      focusUrl={focusUrl}
      mirror={false}
      {...props}
    />
  );
};

ScreenShareTile.displayName = "ScreenShareTile";

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
  /** Whether double-clicking a tile enlarges or shrinks it. */
  enlargeable: boolean;
  onToggleEnlarged: () => void;
  onTogglePin?: () => void;
}

export const GridTile: FC<GridTileProps> = ({
  ref: theirRef,
  vm,
  showSpeakingIndicators,
  showRingingStatus,
  showOutline,
  onOpenProfile,
  className,
  enlargeable,
  ...props
}) => {
  const ourRef = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRefs(ourRef, theirRef);
  const media = useBehavior(vm.media$);
  const displayName = useBehavior(media.displayName$);
  const mxcAvatarUrl = useBehavior(media.mxcAvatarUrl$);
  const enlarged = useBehavior(vm.enlarged$);

  if (media.type === "screen share") {
    return (
      <ScreenShareTile
        ref={ref}
        vm={media}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        enlargeable={enlargeable}
        enlarged={enlarged}
        {...props}
      />
    );
  } else if (media.type === "ringing") {
    return (
      <RingingMediaTile
        ref={ref}
        vm={media}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        showStatus={showRingingStatus}
        className={classNames(className, { [styles.outline]: showOutline })}
        enlargeable={enlargeable}
        enlarged={enlarged}
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
        enlargeable={enlargeable}
        enlarged={enlarged}
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
        enlargeable={enlargeable}
        enlarged={enlarged}
        {...props}
      />
    );
  }
};

GridTile.displayName = "GridTile";
