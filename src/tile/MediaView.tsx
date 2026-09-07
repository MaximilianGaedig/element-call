/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { animated, type SpringValue, to } from "@react-spring/web";
import {
  type FC,
  type ComponentProps,
  type ReactNode,
  type SyntheticEvent,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { VideoTrack } from "@livekit/components-react";
import { Text, Tooltip } from "@vector-im/compound-web";
import {
  AdminIcon,
  ErrorSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import styles from "./MediaView.module.css";
import { Avatar } from "../Avatar";
import { RaisedHandIndicator } from "../reactions/RaisedHandIndicator";
import {
  cropVideo,
  showConnectionStats as showConnectionStatsSetting,
  showHandRaisedTimer,
  useSetting,
} from "../settings/settings";
import { type ReactionOption } from "../reactions";
import { ReactionIndicator } from "../reactions/ReactionIndicator";
import { RTCConnectionStats } from "../RTCConnectionStats";
import videoPlaceholder from "../graphics/video-placeholder.gif";
import { autoVideoFit } from "../utils/videoFit";

interface Props extends ComponentProps<typeof animated.div> {
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  targetWidth: number;
  targetHeight: number;
  video: TrackReferenceOrPlaceholder | undefined;
  /**
   * How to fit the video content inside the tile. When undefined, MediaView
   * chooses a smart default based on the aspect ratios of the tile and video.
   */
  videoFit?: "cover" | "contain";
  /**
   * Shrink the tile to the video's own aspect ratio within the space it was
   * given, rather than letterboxing the video inside it. For screen shares,
   * whose shape is anyone's guess and can change at any moment.
   */
  hugVideo?: boolean;
  mirror: boolean;
  soundWaves?: boolean;
  userId: string;
  videoEnabled: boolean;
  unencryptedWarning: boolean;
  status?: ReactNode;
  showNameTags: boolean;
  nameTagLeadingIcon?: ReactNode;
  /** Whether to mark the name tag as pinned. */
  pinned?: boolean;
  /** Whether to mark the user as a moderator. */
  moderator?: boolean;
  displayName: string;
  mxcAvatarUrl: string | undefined;
  avatarStyle?: "solid" | "translucent";
  background?: "solid" | "transparent";
  focusable: boolean;
  primaryButton?: ReactNode;
  raisedHandTime?: Date;
  /**
   * Where this raised hand comes in the queue of raised hands, if there are
   * several.
   */
  raisedHandOrder?: number;
  /** A warning to show prominently on the tile, e.g. that a moderator muted it. */
  warning?: string;
  currentReaction?: ReactionOption;
  raisedHandOnClick?: () => void;
  waitingForMedia?: boolean;
  audioStreamStats?: RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats;
  videoStreamStats?: RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats;
  rtcBackendIdentity?: string;
  /**
   * The focus url, mainly for debugging purposes.
   */
  focusUrl?: string;
  /**
   * Called whenever the aspect ratio of the video content becomes known or
   * otherwise changes.
   */
  setVideoAspectRatio?: (ratio: number) => void;
}

export const MediaView: FC<Props> = ({
  ref,
  className,
  style,
  targetWidth,
  targetHeight,
  video,
  videoFit,
  hugVideo = false,
  mirror,
  soundWaves,
  userId,
  videoEnabled,
  unencryptedWarning,
  showNameTags,
  nameTagLeadingIcon,
  pinned = false,
  moderator = false,
  displayName,
  mxcAvatarUrl,
  avatarStyle = "solid",
  background = "solid",
  focusable,
  primaryButton,
  status,
  raisedHandTime,
  raisedHandOrder,
  warning,
  currentReaction,
  raisedHandOnClick,
  waitingForMedia,
  audioStreamStats,
  videoStreamStats,
  rtcBackendIdentity,
  focusUrl,
  setVideoAspectRatio: setTheirVideoAspectRatio,
  ...props
}) => {
  const { t } = useTranslation();
  const [handRaiseTimerVisible] = useSetting(showHandRaisedTimer);
  const [showConnectionStats] = useSetting(showConnectionStatsSetting);
  const [crop] = useSetting(cropVideo);

  const avatarSize = Math.round(
    Math.min(targetWidth, targetHeight) *
      (soundWaves === undefined ? 0.5 : 0.38),
  );

  const [videoAspectRatio, setOurVideoAspectRatio] = useState<number>(NaN);
  const tileAspectRatio = targetWidth / targetHeight;
  const hug = hugVideo && video && videoEnabled;
  // A hugged tile is assumed 16:9 until the video shows its shape, so that it
  // starts out the shape it will most likely end up; the fit of an unhugged
  // tile keeps treating the shape as unknown (see autoVideoFit)
  const hugRatio = Number.isNaN(videoAspectRatio) ? 16 / 9 : videoAspectRatio;
  // A tile placed by the grid has animated position and size, so hug by
  // interpolating those; one filling a flex container hugs with CSS instead
  let hugStyle: ComponentProps<typeof animated.div>["style"];
  if (hug && style?.width !== undefined && style.height !== undefined) {
    // The grid animates these as numbers
    const {
      x = 0,
      y = 0,
      width,
      height,
    } = style as {
      x?: number | SpringValue<number>;
      y?: number | SpringValue<number>;
      width: number | SpringValue<number>;
      height: number | SpringValue<number>;
    };
    const w = to([width, height], (w, h) => Math.min(w, h * hugRatio));
    const h = to([width, height], (w, h) => Math.min(h, w / hugRatio));
    hugStyle = {
      width: w,
      height: h,
      x: to([x, width, w], (x, full, w) => x + (full - w) / 2),
      y: to([y, height, h], (y, full, h) => y + (full - h) / 2),
    };
  }

  // Propagate video dimensions (unknown until the video has metadata)
  const setVideoAspectRatio = (ratio: number) => {
    if (!(ratio > 0)) return;
    setOurVideoAspectRatio(ratio);
    setTheirVideoAspectRatio?.(ratio);
  };
  const videoRef = (el: HTMLVideoElement | null) => {
    if (el !== null) setVideoAspectRatio(el.videoWidth / el.videoHeight);
  };
  const onResize = (ev: SyntheticEvent<HTMLVideoElement>) =>
    setVideoAspectRatio(
      ev.currentTarget.videoWidth / ev.currentTarget.videoHeight,
    );

  const moderatorBadge = moderator && (
    <span className={styles.moderatorBadge} title={t("power_level.moderator")}>
      <AdminIcon
        width={20}
        height={20}
        className={styles.moderatorIcon}
        role="img"
        aria-label={t("power_level.moderator")}
      />
    </span>
  );

  const warnings = unencryptedWarning && (
    <Tooltip
      label={t("common.unencrypted")}
      placement="bottom"
      isTriggerInteractive={false}
      nonInteractiveTriggerTabIndex={focusable ? undefined : -1}
    >
      <ErrorSolidIcon
        width={20}
        height={20}
        className={styles.errorIcon}
        role="img"
        aria-label={t("common.unencrypted")}
      />
    </Tooltip>
  );

  return (
    <animated.div
      className={classNames(styles.media, className, {
        [styles.mirror]: mirror,
      })}
      // A container can shape a tile it sizes itself to the video (see
      // --video-aspect-ratio); tiles the grid places are shaped above
      data-hug={hug && hugStyle === undefined ? "true" : undefined}
      style={
        {
          ...style,
          ...hugStyle,
          "--video-aspect-ratio": hug ? hugRatio : undefined,
        } as ComponentProps<typeof animated.div>["style"]
      }
      ref={ref}
      data-testid="videoTile"
      data-video-enabled={video && videoEnabled}
      // Screen shares always ask to be contained; camera video is shown
      // whole unless the user would rather it were cropped to fill the tile
      // (when the two are of a similar shape; a portrait video cropped to a
      // landscape tile would lose too much)
      data-video-fit={
        videoFit ??
        (crop ? autoVideoFit(videoAspectRatio, tileAspectRatio) : "contain")
      }
      data-background={background}
      {...props}
    >
      <div className={styles.bg}>
        {soundWaves !== undefined && (
          <div className={styles.waves} data-visible={soundWaves}>
            <div className={styles.wave} />
            <div className={styles.wave} />
            <div className={styles.wave} />
            <div className={styles.speakingBorder} />
          </div>
        )}
        <Avatar
          id={userId}
          name={displayName}
          size={avatarSize}
          src={mxcAvatarUrl}
          data-style={avatarStyle}
          className={styles.avatar}
          style={{ display: video && videoEnabled ? "none" : "initial" }}
        />
        {video?.publication !== undefined && (
          <VideoTrack
            trackRef={video}
            // There's no reason for this to be focusable
            tabIndex={-1}
            disablePictureInPicture
            data-testid="video"
            // Set the placeholder to a small transparent image. (On Android web
            // views the default poster image is particularly ugly.)
            poster={videoPlaceholder}
            ref={videoRef}
            onResize={onResize}
          />
        )}
      </div>
      <div className={styles.fg}>
        <div className={styles.reactions}>
          {warning && <div className={styles.warning}>{warning}</div>}
          <RaisedHandIndicator
            raisedHandTime={raisedHandTime}
            order={raisedHandOrder}
            miniature={avatarSize < 96}
            showTimer={handRaiseTimerVisible}
            onClick={raisedHandOnClick}
            tabIndex={focusable ? undefined : -1}
          />
          {currentReaction && (
            <ReactionIndicator
              miniature={avatarSize < 96}
              emoji={currentReaction.emoji}
            />
          )}
        </div>
        {waitingForMedia && (
          <div className={styles.status}>
            {t("video_tile.waiting_for_media")}
            {showConnectionStats ? " " + rtcBackendIdentity : ""}
          </div>
        )}
        {showConnectionStats && (
          <>
            <RTCConnectionStats
              audio={audioStreamStats}
              video={videoStreamStats}
              focusUrl={focusUrl}
              rtcBackendIdentity={rtcBackendIdentity}
            />
          </>
        )}
        {status && <div className={styles.status}>{status}</div>}
        {showNameTags && targetWidth >= 100 ? (
          <div className={styles.nameTag}>
            {nameTagLeadingIcon}
            {moderatorBadge}
            <Text
              as="span"
              size="sm"
              weight="medium"
              className={styles.name}
              data-testid="name_tag"
              title={userId}
            >
              {pinned && "📌 "}
              {displayName}
            </Text>
            {warnings}
          </div>
        ) : (
          warnings
        )}
        <div className={styles.buttons}>{primaryButton}</div>
      </div>
    </animated.div>
  );
};

MediaView.displayName = "MediaView";
