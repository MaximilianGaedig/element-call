/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type ReactNode, type Ref, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@vector-im/compound-web";
import {
  DisambiguatedProfileView,
  EventContentBodyView,
  EventTileView,
  I18nApi,
  I18nContext,
  MessageTimestampView,
  type TimelineItem,
  TimelineView,
  type TimelineViewSnapshot,
  type ViewModel,
} from "@element-hq/web-shared-components";
import "@element-hq/web-shared-components/dist/element-web-shared-components.css";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type Caption } from "../state/Transcription";
import { useBehavior } from "../useBehavior";
import styles from "./CallCaptions.module.css";

// The shared components ship their own English strings
export const i18n = new I18nApi();

/** A shared-components view model that never changes. */
function constantVm<S>(snapshot: S): ViewModel<S> {
  return { getSnapshot: () => snapshot, subscribe: () => () => {} };
}

const noop = (): void => {};
const timelineActions = {
  onStartReached: noop,
  onEndReached: noop,
  onAnchorReached: noop,
  onVisibleRangeChanged: noop,
  onAtBottomStateChange: noop,
  onJumpToReadMarker: noop,
  onMarkAllAsRead: noop,
  onJumpToLive: noop,
};

const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

/**
 * One transcript segment. The bot posts them as "Speaker: words", so the
 * speaker is shown as the sender rather than the bot. The body grows as
 * the bot streams the speaker's words.
 */
export const Segment: FC<Caption> = ({ event, body }) => {
  // View models must hand back the same snapshot until something changes,
  // or the shared components' store hook re-renders forever
  const vms = useMemo(() => {
    const match = /^(.+?): (.*)$/s.exec(body);
    const ts = event.getTs();
    return {
      speaker: match?.[1],
      sender: constantVm({
        displayName: match?.[1] ?? "",
        emphasizeDisplayName: true,
      }),
      body: constantVm({ body: match?.[2] ?? body }),
      timestamp: constantVm({
        ts: time.format(ts),
        tsSentAt: dateTime.format(ts),
        inhibitTooltip: true,
      }),
    };
  }, [event, body]);
  const id = event.getId()!;
  return (
    <EventTileView
      root={{
        id,
        eventId: id,
        shape: "Thread",
        state: { isOwnEvent: false, hasReply: false, noSender: !vms.speaker },
      }}
      slots={{
        sender: vms.speaker && <DisambiguatedProfileView vm={vms.sender} />,
        body: <EventContentBodyView vm={vms.body} as="div" />,
        timestamp: <MessageTimestampView vm={vms.timestamp} />,
      }}
    />
  );
};

/**
 * Live captions: the transcript the transcriber bot posts as a thread,
 * rendered as a fragment of timeline above the call controls while
 * transcription is on.
 */
export const CallCaptions: FC<{
  vm: CallViewModel;
  /** Measured by the call view, which makes room for the panel */
  ref?: Ref<HTMLElement>;
  /**
   * How far the panel extends under the footer, in pixels; its text stays
   * above.
   */
  inset?: number;
}> = ({ vm, ref, inset = 0 }) => {
  const { t } = useTranslation();
  const transcription = useBehavior(vm.transcription.transcription$);
  const segments = useBehavior(vm.transcription.segments$);
  const timelineVm = useMemo(() => {
    const { segments$ } = vm.transcription;
    // Snapshots must be stable between renders (see Segment), so one is
    // built only when the segments change
    let snapshot: TimelineViewSnapshot | null = null;
    let from: Caption[] | null = null;
    const getSnapshot = (): TimelineViewSnapshot => {
      if (snapshot === null || segments$.value !== from) {
        from = segments$.value;
        snapshot = {
          items: from.map(({ event }, i) => ({
            key: event.getId()!,
            kind: "event",
            continuation: false,
            lastInSection: i === from!.length - 1,
          })),
          atLiveEnd: true,
          pendingAnchor: null,
          highlightedEventId: null,
          isAtBottom: true,
          canJumpToReadMarker: false,
          numUnreadMessages: 0,
          hasHighlights: false,
        };
      }
      return snapshot;
    };
    return {
      getSnapshot,
      subscribe: (listener: () => void) =>
        segments$.subscribe(() => listener()),
      ...timelineActions,
    };
  }, [vm]);
  const renderItem = (item: TimelineItem): ReactNode => {
    const caption = segments.find((c) => c.event.getId() === item.key);
    return caption && <Segment {...caption} />;
  };

  if (transcription === null) return null;
  return (
    <I18nContext.Provider value={i18n}>
      <section
        className={styles.captions}
        aria-label={t("captions.title")}
        ref={ref}
        style={{
          blockSize: `calc(var(--captions-height) + ${inset}px)`,
          marginBlockEnd: -inset,
          paddingBlockEnd: inset,
        }}
      >
        {segments.length === 0 ? (
          <Text size="sm" className={styles.waiting}>
            {transcription.rootId === null
              ? t("captions.waiting")
              : t("captions.listening")}
          </Text>
        ) : (
          <TimelineView vm={timelineVm} renderItem={renderItem} />
        )}
      </section>
    </I18nContext.Provider>
  );
};
