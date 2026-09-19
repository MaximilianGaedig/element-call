/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ComponentProps,
  type CSSProperties,
  type FC,
  type ReactNode,
  type Ref,
  type RefAttributes,
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ExpandIcon,
  CollapseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  VolumeOffIcon,
  VolumeOnIcon,
  VolumeOffSolidIcon,
  VolumeOnSolidIcon,
  PinIcon,
  OverflowHorizontalIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { animated } from "@react-spring/web";

import {
  Grid,
  type LayoutProps,
  type TileProps,
  useUpdateLayout,
} from "../grid/Grid";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { type TrackReferenceOrPlaceholder } from "@livekit/components-core";
import {
  ContextMenu,
  Menu,
  MenuItem,
  Text,
  ToggleMenuItem,
} from "@vector-im/compound-web";

import { MediaView } from "./MediaView";
import styles from "./SpotlightTile.module.css";
import { useInitial } from "../useInitial";
import { useMergedRefs } from "../useMergedRefs";
import { useReactiveState } from "../useReactiveState";
import { useLatest } from "../useLatest";
import { type SpotlightTileViewModel } from "../state/TileViewModel";
import { useBehavior } from "../useBehavior";
import { type Behavior, computed, state } from "../state/Behavior";
import { type MemberMediaViewModel } from "../state/media/MemberMediaViewModel";
import { type LocalUserMediaViewModel } from "../state/media/LocalUserMediaViewModel";
import { type RemoteUserMediaViewModel } from "../state/media/RemoteUserMediaViewModel";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import { type RemoteScreenShareViewModel } from "../state/media/RemoteScreenShareViewModel";
import { type MediaViewModel } from "../state/media/MediaViewModel";
import { Slider } from "../Slider";
import { type RingingMediaViewModel } from "../state/media/RingingMediaViewModel";
import { RingingStatus } from "./RingingStatus";
import { UserMediaMenuItems } from "./UserMediaMenuItems";
import { hugVideo, relaxedGrid, useSetting } from "../settings/settings";
import { fitRowHeight } from "../grid/CallLayout";
import { videoAspectRatio } from "../grid/TileGrid";
import { shallowEquals as shallowArrayEquals } from "../utils/array";

interface SpotlightItemBaseProps {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  "data-id": string;
  targetWidth: number;
  targetHeight: number;
  userId: string;
  displayName: string;
  mxcAvatarUrl: string | undefined;
  showNameTags: boolean;
  background: "solid" | "transparent";
  focusable: boolean;
  "aria-hidden"?: boolean;
  setVideoAspectRatio?: (ratio: number) => void;
}

interface SpotlightMemberMediaItemBaseProps extends SpotlightItemBaseProps {
  video: TrackReferenceOrPlaceholder | undefined;
  unencryptedWarning: boolean;
  focusUrl: string | undefined;
  videoFit?: "cover" | "contain";
}

interface SpotlightUserMediaItemBaseProps extends SpotlightMemberMediaItemBaseProps {
  videoEnabled: boolean;
  soundWaves: boolean | undefined;
  pinned: boolean;
  moderator: boolean;
  primaryButton: ReactNode;
}

interface SpotlightLocalUserMediaItemProps extends SpotlightUserMediaItemBaseProps {
  vm: LocalUserMediaViewModel;
}

const SpotlightLocalUserMediaItem: FC<SpotlightLocalUserMediaItemProps> = ({
  vm,
  ...props
}) => {
  const mirror = useBehavior(vm.mirror$);
  return <MediaView mirror={mirror} {...props} />;
};

SpotlightLocalUserMediaItem.displayName = "SpotlightLocalUserMediaItem";

interface SpotlightRemoteUserMediaItemProps extends SpotlightUserMediaItemBaseProps {
  vm: RemoteUserMediaViewModel;
}

const SpotlightRemoteUserMediaItem: FC<SpotlightRemoteUserMediaItemProps> = ({
  vm,
  ...props
}) => {
  const waitingForMedia = useBehavior(vm.waitingForMedia$);
  return (
    <MediaView waitingForMedia={waitingForMedia} mirror={false} {...props} />
  );
};

interface SpotlightUserMediaItemProps extends SpotlightMemberMediaItemBaseProps {
  vm: UserMediaViewModel;
  onUnpin: ((vm: UserMediaViewModel) => void) | undefined;
  buttons: ReactNode;
  hugVideo?: boolean;
}

const SpotlightUserMediaItem: FC<SpotlightUserMediaItemProps> = ({
  vm,
  targetWidth,
  targetHeight,
  onUnpin,
  buttons,
  ...props
}) => {
  const { t } = useTranslation();
  const videoEnabled = useBehavior(vm.videoEnabled$);
  const speaking = useBehavior(vm.speaking$);
  const pinned = useBehavior(vm.pinned$);
  const isModerator = useBehavior(vm.isModerator$);
  const moderation = useBehavior(vm.moderation$);
  const unpinnable = pinned && !moderation.pinned && onUnpin !== undefined;
  // Moderators are shown which tiles they've applied floor control to
  const moderator = useBehavior(vm.moderator$);
  const moderated = moderator !== null && moderation.explicit;

  // Pinned users live here rather than in the grid, so they get the same menu
  // as a grid tile (from its options button and by right-click), plus a way
  // to unpin them (unless it was a moderator who pinned them, which the
  // moderator controls cover)
  const menu = (
    <UserMediaMenuItems
      vm={vm}
      leading={
        unpinnable ? (
          <ToggleMenuItem
            Icon={PinIcon}
            label={t("video_tile.pin")}
            checked
            onSelect={(e) => {
              e.preventDefault();
              onUnpin(vm);
            }}
          />
        ) : null
      }
    />
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const primaryButton = (
    <>
      {buttons}
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={`${props.displayName} (${props.userId})`}
        trigger={
          <button
            aria-label={t("common.options")}
            tabIndex={props.focusable ? undefined : -1}
            data-moderated={moderated || undefined}
          >
            <OverflowHorizontalIcon aria-hidden width={20} height={20} />
          </button>
        }
        side="left"
        align="start"
      >
        {menu}
      </Menu>
    </>
  );

  const baseProps: SpotlightUserMediaItemBaseProps &
    RefAttributes<HTMLDivElement> = {
    setVideoAspectRatio: vm.setVideoAspectRatio,
    videoEnabled,
    soundWaves: props.background === "transparent" ? speaking : undefined,
    pinned,
    moderator: isModerator,
    primaryButton,
    targetWidth,
    targetHeight,
    ...props,
  };

  const item = vm.local ? (
    <SpotlightLocalUserMediaItem vm={vm} {...baseProps} />
  ) : (
    <SpotlightRemoteUserMediaItem vm={vm} {...baseProps} />
  );

  return (
    <ContextMenu
      title={props.displayName}
      trigger={item}
      hasAccessibleAlternative
    >
      {menu}
    </ContextMenu>
  );
};

SpotlightUserMediaItem.displayName = "SpotlightUserMediaItem";

interface SpotlightScreenShareItemProps extends SpotlightMemberMediaItemBaseProps {
  vm: ScreenShareViewModel;
  videoEnabled: boolean;
  buttons: ReactNode;
}

const SpotlightScreenShareItem: FC<SpotlightScreenShareItemProps> = ({
  vm,
  buttons,
  ...props
}) => {
  return (
    <MediaView
      videoFit="contain"
      hugVideo
      mirror={false}
      primaryButton={buttons}
      {...props}
    />
  );
};

interface SpotlightRemoteScreenShareItemProps extends SpotlightMemberMediaItemBaseProps {
  vm: RemoteScreenShareViewModel;
  buttons: ReactNode;
}

const SpotlightRemoteScreenShareItem: FC<
  SpotlightRemoteScreenShareItemProps
> = ({ vm, buttons, ...props }) => {
  const videoEnabled = useBehavior(vm.videoEnabled$);
  return (
    <SpotlightScreenShareItem
      vm={vm}
      videoEnabled={videoEnabled}
      buttons={
        <>
          <ScreenShareVolumeButton vm={vm} />
          {buttons}
        </>
      }
      {...props}
    />
  );
};

interface SpotlightMemberMediaItemProps extends SpotlightItemBaseProps {
  vm: MemberMediaViewModel;
  tiled: boolean;
  onUnpin: ((vm: UserMediaViewModel) => void) | undefined;
  /** Whether this item has been zoomed in on to fill the whole view. */
  zoomed: boolean;
  onToggleZoom: (() => void) | undefined;
}

const SpotlightMemberMediaItem: FC<SpotlightMemberMediaItemProps> = ({
  vm,
  tiled,
  onUnpin,
  zoomed,
  onToggleZoom,
  ...props
}) => {
  const { t } = useTranslation();
  const ZoomIcon = zoomed ? CollapseIcon : ExpandIcon;
  const buttons = onToggleZoom && (
    <button
      aria-label={zoomed ? t("video_tile.collapse") : t("video_tile.expand")}
      onClick={onToggleZoom}
      tabIndex={props.focusable ? undefined : -1}
    >
      <ZoomIcon aria-hidden width={20} height={20} />
    </button>
  );
  const video = useBehavior(vm.video$);
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const focusUrl = useBehavior(vm.focusUrl$);
  const [hug] = useSetting(hugVideo);

  const baseProps: SpotlightMemberMediaItemBaseProps &
    RefAttributes<HTMLDivElement> = {
    video: video ?? undefined,
    unencryptedWarning,
    focusUrl,
    ...props,
  };

  // Tiled cells are often a different shape from the video, and letterboxing
  // several of them looks like a wall of black bars, so fill the cell instead
  if (vm.type === "user")
    return (
      <SpotlightUserMediaItem
        vm={vm}
        videoFit={tiled ? "cover" : undefined}
        hugVideo={hug}
        onUnpin={onUnpin}
        buttons={buttons}
        {...baseProps}
      />
    );
  return vm.local ? (
    <SpotlightScreenShareItem
      vm={vm}
      videoEnabled
      buttons={buttons}
      {...baseProps}
    />
  ) : (
    <SpotlightRemoteScreenShareItem vm={vm} buttons={buttons} {...baseProps} />
  );
};

interface SpotlightRingingMediaItemProps extends SpotlightItemBaseProps {
  vm: RingingMediaViewModel;
  showStatus: boolean;
}

const SpotlightRingingMediaItem: FC<SpotlightRingingMediaItemProps> = ({
  vm,
  showStatus,
  ...props
}) => {
  return (
    <MediaView
      video={undefined}
      unencryptedWarning={false}
      status={
        showStatus && (
          <Text as="span" size="md" weight="medium">
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

interface SpotlightItemProps {
  ref?: Ref<HTMLDivElement>;
  vm: MediaViewModel;
  /**
   * The width this tile will have once its animations have settled.
   */
  targetWidth: number;
  /**
   * The height this tile will have once its animations have settled.
   */
  targetHeight: number;
  showNameTags: boolean;
  showRingingStatus: boolean;
  background: "solid" | "transparent";
  focusable: boolean;
  intersectionObserver$: Behavior<IntersectionObserver>;
  /**
   * Whether this item should act as a scroll snapping point.
   */
  snap: boolean;
  /** Whether this item shares the spotlight with others as a tile. */
  tiled: boolean;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  "aria-hidden"?: boolean;
  onUnpin: ((vm: UserMediaViewModel) => void) | undefined;
  zoomed: boolean;
  onToggleZoom: (() => void) | undefined;
}

const SpotlightItem: FC<SpotlightItemProps> = ({
  ref: theirRef,
  vm,
  style,
  targetWidth,
  targetHeight,
  showNameTags,
  showRingingStatus,
  background,
  focusable,
  intersectionObserver$,
  snap,
  tiled,
  className,
  "aria-hidden": ariaHidden,
  onUnpin,
  zoomed,
  onToggleZoom,
}) => {
  const ourRef = useRef<HTMLDivElement | null>(null);

  const ref = useMergedRefs(ourRef, theirRef);
  const displayName = useBehavior(vm.displayName$);
  const mxcAvatarUrl = useBehavior(vm.mxcAvatarUrl$);

  // Hook this item up to the intersection observer
  useEffect(() => {
    const element = ourRef.current!;
    let prevIo: IntersectionObserver | null = null;
    const unsubscribe = intersectionObserver$.subscribe((io) => {
      prevIo?.unobserve(element);
      io.observe(element);
      prevIo = io;
    });
    return (): void => {
      unsubscribe();
      prevIo?.unobserve(element);
    };
  }, [intersectionObserver$]);

  const baseProps: SpotlightItemBaseProps & RefAttributes<HTMLDivElement> = {
    ref,
    "data-id": vm.id,
    className: classNames(className, styles.item, { [styles.snap]: snap }),
    style,
    targetWidth,
    targetHeight,
    userId: vm.userId,
    displayName,
    mxcAvatarUrl,
    showNameTags,
    background,
    focusable,
    "aria-hidden": ariaHidden,
  };

  return vm.type === "ringing" ? (
    <SpotlightRingingMediaItem
      vm={vm}
      showStatus={showRingingStatus}
      {...baseProps}
    />
  ) : (
    <SpotlightMemberMediaItem
      vm={vm}
      tiled={tiled}
      onUnpin={onUnpin}
      zoomed={zoomed}
      onToggleZoom={onToggleZoom}
      {...baseProps}
    />
  );
};

SpotlightItem.displayName = "SpotlightItem";

interface ScreenShareVolumeButtonProps {
  vm: RemoteScreenShareViewModel;
}

const ScreenShareVolumeButton: FC<ScreenShareVolumeButtonProps> = ({ vm }) => {
  const { t } = useTranslation();

  const audioEnabled = useBehavior(vm.audioEnabled$);
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const playbackVolume = useBehavior(vm.playbackVolume$);

  const VolumeIcon = playbackMuted ? VolumeOffIcon : VolumeOnIcon;
  const VolumeSolidIcon = playbackMuted
    ? VolumeOffSolidIcon
    : VolumeOnSolidIcon;

  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const onMuteButtonClick = useCallback(() => vm.togglePlaybackMuted(), [vm]);
  const onVolumeChange = useCallback(
    (v: number) => vm.adjustPlaybackVolume(v),
    [vm],
  );
  const onVolumeCommit = useCallback(() => vm.commitPlaybackVolume(), [vm]);

  return (
    audioEnabled && (
      <Menu
        open={volumeMenuOpen}
        onOpenChange={setVolumeMenuOpen}
        title={t("video_tile.screen_share_volume")}
        side="top"
        align="end"
        trigger={
          <button aria-label={t("video_tile.screen_share_volume")}>
            <VolumeSolidIcon aria-hidden width={20} height={20} />
          </button>
        }
      >
        <MenuItem
          as="div"
          className={styles.volumeMenuItem}
          onSelect={null}
          label={null}
          hideChevron={true}
        >
          <button className={styles.menuMuteButton} onClick={onMuteButtonClick}>
            <VolumeIcon aria-hidden width={24} height={24} />
          </button>
          <Slider
            className={styles.volumeSlider}
            label={t("video_tile.volume")}
            value={playbackVolume}
            min={0}
            max={1}
            step={0.01}
            onValueChange={onVolumeChange}
            onValueCommit={onVolumeCommit}
          />
        </MenuItem>
      </Menu>
    )
  );
};

/** What the tiled items share, beyond what each gets from its slot. */
interface SpotlightItemsContext {
  showNameTags: boolean;
  showRingingStatus: boolean;
  background: "solid" | "transparent";
  focusable: boolean;
  intersectionObserver$: Behavior<IntersectionObserver>;
  className: string | undefined;
  onUnpin: ((vm: UserMediaViewModel) => void) | undefined;
  onToggleZoom: ((vm: MediaViewModel) => void) | undefined;
}

const SpotlightItemsContext = createContext<SpotlightItemsContext | null>(null);

interface SpotlightItemsModel {
  items: MediaViewModel[];
  columns: number;
  /** The size of the space the items are laid out in. */
  width: number;
  height: number;
  onMove: ((media: MediaViewModel, to: MediaViewModel) => void) | undefined;
}

const itemGap = 20; // Must match the gap in the CSS, and the rail's

// When the spotlight shows several media as tiles, they're laid out by the
// same Grid as the call's tiles, so that they can be dragged and rearranged
// with exactly the same behaviour: this is its layout of slots...
const SpotlightItemsLayout: FC<
  LayoutProps<SpotlightItemsModel, MediaViewModel, HTMLDivElement>
> = ({ ref, model: { items, columns, width, height, onMove }, Slot }) => {
  useUpdateLayout();
  // Rows of one height, each tile as wide as its video's shape makes it,
  // as in the grid layout (see relaxedGrid)
  const [relaxed] = useSetting(relaxedGrid);
  const aspectRatios = useBehavior(
    useMemo(
      () => computed(() => items.map(videoAspectRatio), shallowArrayEquals),
      [items],
    ),
  );
  const rows = useMemo(() => {
    if (!relaxed) return null;
    // A tile without a video takes the shape of a cell of the plain grid
    const cellRatio =
      (width / columns) * (Math.ceil(items.length / columns) / height);
    const ratios = aspectRatios.map((ar) => ar || cellRatio);
    // fitRowHeight pads its bounds by a gap on every side; we have none
    const fit = fitRowHeight(
      width + 2 * itemGap,
      height + 2 * itemGap,
      itemGap,
      ratios,
    );
    const rowHeight = Math.min(fit, ...ratios.map((ar) => width / ar));
    return {
      height: rowHeight,
      widths: ratios.map((ar) => Math.min(rowHeight * ar, width)),
    };
  }, [relaxed, aspectRatios, width, height, columns, items.length]);
  return (
    <div
      ref={ref}
      className={styles.itemsLayout}
      data-relaxed={rows !== null || undefined}
      style={
        {
          "--tiled-columns": columns,
          "--height": rows && `${Math.floor(rows.height)}px`,
        } as CSSProperties
      }
    >
      {items.map((vm, i) => (
        <Slot
          key={vm.id}
          id={vm.id}
          model={vm}
          className={styles.itemSlot}
          style={rows ? { width: Math.floor(rows.widths[i]) } : undefined}
          onDrag={
            onMove &&
            (({ over }): void => {
              const to = items.find((m) => m.id === over);
              if (to !== undefined) onMove(vm, to);
            })
          }
        />
      ))}
    </div>
  );
};

// ...and this is the tile that fills each slot
const SpotlightItemTile: FC<TileProps<MediaViewModel, HTMLDivElement>> = ({
  ref,
  className,
  style,
  targetWidth,
  targetHeight,
  model: vm,
}) => {
  const context = use(SpotlightItemsContext)!;
  return (
    <SpotlightItem
      ref={ref}
      vm={vm}
      className={classNames(className, context.className)}
      style={style}
      targetWidth={targetWidth}
      targetHeight={targetHeight}
      showNameTags={context.showNameTags}
      showRingingStatus={context.showRingingStatus}
      background={context.background}
      focusable={context.focusable}
      intersectionObserver$={context.intersectionObserver$}
      snap={false}
      tiled
      onUnpin={context.onUnpin}
      zoomed={false}
      onToggleZoom={context.onToggleZoom && (() => context.onToggleZoom!(vm))}
    />
  );
};

interface Props {
  ref?: Ref<HTMLDivElement>;
  vm: SpotlightTileViewModel;
  expanded: boolean;
  onToggleExpanded: (() => void) | null;
  targetWidth: number;
  targetHeight: number;
  showIndicators: boolean;
  /**
   * Whether to show multiple media all at once as tiles, rather than paging
   * through them one at a time.
   */
  tiled?: boolean;
  /** Unpins a user the local user pinned; enables Unpin in item menus. */
  onUnpin?: (vm: UserMediaViewModel) => void;
  /** Moves a tiled item to where another sits; enables dragging them. */
  onMove?: (media: MediaViewModel, to: MediaViewModel) => void;
  showNameTags: boolean;
  showRingingStatus: boolean;
  focusable: boolean;
  className?: string;
  /**
   * CSS class of the individual spotlight items.
   */
  itemClassName?: string;
  style?: ComponentProps<typeof animated.div>["style"];
}

export const SpotlightTile: FC<Props> = ({
  ref: theirRef,
  vm,
  expanded,
  onToggleExpanded,
  targetWidth,
  targetHeight,
  showIndicators,
  tiled: tiledProp = false,
  onUnpin,
  onMove,
  showNameTags,
  showRingingStatus,
  focusable = true,
  className,
  itemClassName,
  style,
}) => {
  const { t } = useTranslation();
  const root$ = useInitial(() => state<HTMLDivElement | null>(null));
  const ourRef = useCallback(
    (element: HTMLDivElement | null) => {
      root$.value = element;
    },
    [root$],
  );
  const ref = useMergedRefs(ourRef, theirRef);
  const maximised = useBehavior(vm.maximised$);
  const background = useBehavior(vm.background$);
  const allMedia = useBehavior(vm.media$);
  const canTile = tiledProp && allMedia.length > 1 && !expanded;
  // Zooming in on an item expands the spotlight and shows that item alone
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoomed = expanded
    ? allMedia.find((vm) => vm.id === zoomedId)
    : undefined;
  const media = useMemo(
    () => (zoomed === undefined ? allMedia : [zoomed]),
    [zoomed, allMedia],
  );
  const onToggleZoom = useMemo(
    () =>
      onToggleExpanded === null
        ? undefined
        : (vm: MediaViewModel): void => {
            if (zoomed?.id === vm.id) {
              setZoomedId(null);
              onToggleExpanded();
            } else {
              setZoomedId(vm.id);
              if (!expanded) onToggleExpanded();
            }
          },
    [onToggleExpanded, zoomed, expanded],
  );
  const [visibleId, setVisibleId] = useState<string | undefined>(media[0]?.id);
  const latestMedia = useLatest(media);
  const latestVisibleId = useLatest(visibleId);
  const visibleIndex = media.findIndex((vm) => vm.id === visibleId);
  const tiled = canTile && media.length > 1;
  const columns = Math.ceil(Math.sqrt(media.length));
  const canGoBack = !tiled && visibleIndex > 0;
  const canGoToNext =
    !tiled && visibleIndex !== -1 && visibleIndex < media.length - 1;

  // To keep track of which item is visible, we need an intersection observer
  // hooked up to the root element and the items. Because the items will run
  // their effects before their parent does, we need to do this dance with an
  // Observable to actually give them the intersection observer.
  const intersectionObserver$ = useInitial(() =>
    computed(
      () =>
        new IntersectionObserver(
          (entries) => {
            const visible = entries.find((e) => e.isIntersecting);
            if (visible !== undefined)
              setVisibleId(visible.target.getAttribute("data-id")!);
          },
          { root: root$.value, threshold: 0.5 },
        ),
    ),
  );

  const [scrollToId, setScrollToId] = useReactiveState<string | null>(
    (prev) =>
      prev == null || prev === visibleId || media.every((vm) => vm.id !== prev)
        ? null
        : prev,
    [visibleId],
  );

  const onBackClick = useCallback(() => {
    const media = latestMedia.current;
    const visibleIndex = media.findIndex(
      (vm) => vm.id === latestVisibleId.current,
    );
    if (visibleIndex > 0) setScrollToId(media[visibleIndex - 1].id);
  }, [latestVisibleId, latestMedia, setScrollToId]);

  const onNextClick = useCallback(() => {
    const media = latestMedia.current;
    const visibleIndex = media.findIndex(
      (vm) => vm.id === latestVisibleId.current,
    );
    if (visibleIndex !== -1 && visibleIndex !== media.length - 1)
      setScrollToId(media[visibleIndex + 1].id);
  }, [latestVisibleId, latestMedia, setScrollToId]);

  const itemsContext = useMemo<SpotlightItemsContext>(
    () => ({
      showNameTags,
      showRingingStatus,
      background,
      focusable,
      intersectionObserver$,
      className: itemClassName,
      onUnpin,
      onToggleZoom,
    }),
    [
      showNameTags,
      showRingingStatus,
      background,
      focusable,
      intersectionObserver$,
      itemClassName,
      onUnpin,
      onToggleZoom,
    ],
  );
  const itemsModel = useMemo<SpotlightItemsModel>(
    () => ({
      items: media,
      columns,
      width: targetWidth,
      height: targetHeight,
      onMove,
    }),
    [media, columns, targetWidth, targetHeight, onMove],
  );

  return (
    <animated.div
      ref={ref}
      className={classNames(className, styles.tile)}
      data-maximised={maximised}
      // User items have an options button in the bottom-right corner, which
      // the tile's own buttons must stay clear of
      style={style}
    >
      {canGoBack && (
        <button
          className={classNames(styles.advance, styles.back)}
          aria-label={t("common.back")}
          onClick={onBackClick}
          tabIndex={focusable ? undefined : -1}
        >
          <ChevronLeftIcon aria-hidden width={24} height={24} />
        </button>
      )}
      {tiled ? (
        <SpotlightItemsContext value={itemsContext}>
          <Grid
            className={classNames(styles.contents, styles.itemsGrid)}
            model={itemsModel}
            Layout={SpotlightItemsLayout}
            Tile={SpotlightItemTile}
          />
        </SpotlightItemsContext>
      ) : (
        <div className={styles.contents}>
          {media.map((vm) => (
            <SpotlightItem
              key={vm.id}
              vm={vm}
              targetWidth={targetWidth}
              targetHeight={targetHeight}
              showRingingStatus={showRingingStatus}
              showNameTags={showNameTags}
              background={background}
              focusable={focusable}
              intersectionObserver$={intersectionObserver$}
              // This is how we get the container to scroll to the right media
              // when the previous/next buttons are clicked: we temporarily
              // remove all scroll snap points except for just the one media
              // that we want to bring into view
              snap={scrollToId === null || scrollToId === vm.id}
              tiled={false}
              className={itemClassName}
              aria-hidden={
                media.length > 1 && (scrollToId ?? visibleId) !== vm.id
              }
              onUnpin={onUnpin}
              zoomed={zoomed?.id === vm.id}
              onToggleZoom={onToggleZoom && (() => onToggleZoom(vm))}
            />
          ))}
        </div>
      )}

      {canGoToNext && (
        <button
          className={classNames(styles.advance, styles.next)}
          aria-label={t("common.next")}
          onClick={onNextClick}
          tabIndex={focusable ? undefined : -1}
        >
          <ChevronRightIcon aria-hidden width={24} height={24} />
        </button>
      )}
      {!expanded && (
        <div
          className={classNames(styles.indicators, {
            [styles.show]: showIndicators && !tiled && media.length > 1,
          })}
        >
          {media.map((vm) => (
            <div
              data-testid="screenshare-indicator"
              key={vm.id}
              className={styles.item}
              data-visible={vm.id === visibleId}
            />
          ))}
        </div>
      )}
    </animated.div>
  );
};

SpotlightTile.displayName = "SpotlightTile";
