/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type FC,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "@vector-im/compound-web";
import { ChevronDownIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import {
  DisambiguatedProfileView,
  EventContentBodyView,
  EventTileView,
  I18nApi,
  I18nContext,
  MessageTimestampView,
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

const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

/**
 * How long a speaker pauses before their next segment gets a new header:
 * long enough that the sentences of one train of thought stay together,
 * short enough that a fresh remark after a lull reads as one.
 */
const groupGapMs = 5_000;

/**
 * One transcript segment, shown as the speaker's words rather than the
 * bot's: the bot names the speaker in the event, or failing that posts
 * the body as "Speaker: words". The body grows as the bot streams the
 * speaker's words.
 */
export const Segment: FC<Caption & { continuation?: boolean }> = ({
  event,
  body,
  speaker,
  continuation = false,
}) => {
  // View models must hand back the same snapshot until something changes,
  // or the shared components' store hook re-renders forever
  const vms = useMemo(() => {
    const match = /^(.+?): (.*)$/s.exec(body);
    const name = speaker ?? match?.[1];
    const ts = event.getTs();
    return {
      speaker: name,
      sender: constantVm({
        displayName: name ?? "",
        emphasizeDisplayName: true,
      }),
      body: constantVm({ body: match?.[2] ?? body }),
      timestamp: constantVm({
        ts: time.format(ts),
        tsSentAt: dateTime.format(ts),
        inhibitTooltip: true,
      }),
    };
  }, [event, body, speaker]);
  const id = event.getId()!;
  return (
    <EventTileView
      root={{
        id,
        eventId: id,
        shape: "Thread",
        state: {
          isOwnEvent: false,
          hasReply: false,
          noSender: !vms.speaker,
          continuation,
        },
      }}
      slots={{
        sender: vms.speaker && !continuation && (
          <DisambiguatedProfileView vm={vms.sender} />
        ),
        body: <EventContentBodyView vm={vms.body} as="div" />,
        timestamp: <MessageTimestampView vm={vms.timestamp} />,
      }}
    />
  );
};

/**
 * Live captions: what the transcriber bot hears, rendered as a list of
 * message tiles above the call controls while this device has captions on.
 */
/** How close to the bottom still counts as following along. */
const scrollSlackPx = 8;
const minHeightPx = 60;
const maxHeightRatio = 0.6;
const keyStepPx = 20;
const heightKey = "captions-height";
const loadHeight = (): number | null => {
  try {
    const stored = Number(localStorage.getItem(heightKey));
    return stored >= minHeightPx ? stored : null;
  } catch {
    return null;
  }
};

const speakerOf = ({ body, speaker }: Caption): string | undefined =>
  speaker ?? /^(.+?): /.exec(body)?.[1];

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
  const segments = useBehavior(vm.transcription.segments$);
  const listening = useBehavior(vm.transcription.listening$);

  // Keep the latest words in view as they arrive, unless the user has
  // scrolled up to read back, in which case they're offered a way down.
  // (The shared TimelineView is not used here: a few lines need no
  // virtualising, and it never leaves its loading state under React
  // StrictMode.)
  const list = useRef<HTMLOListElement>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const toLatest = useCallback((): void => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, []);
  const onScroll = useCallback((): void => {
    const l = list.current;
    if (l)
      setScrolledUp(
        l.scrollHeight - l.scrollTop - l.clientHeight > scrollSlackPx,
      );
  }, []);
  useEffect(() => {
    if (!scrolledUp) toLatest();
    // Only new words should move the view, not the user reaching the bottom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, toLatest]);

  // The top edge drags to give the transcript more or less of the view
  const [height, setHeight] = useState(loadHeight);
  const section = useRef<HTMLElement | null>(null);
  const resize = useCallback((to: number): void => {
    const clamped = Math.round(
      Math.min(Math.max(to, minHeightPx), window.innerHeight * maxHeightRatio),
    );
    setHeight(clamped);
    try {
      localStorage.setItem(heightKey, String(clamped));
    } catch {
      // Without storage the height just doesn't outlive the call
    }
  }, []);
  const currentHeight = (): number =>
    (section.current?.getBoundingClientRect().height ?? 0) - inset;
  const drag = useRef<{ y: number; height: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, height: currentHeight() };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current) resize(drag.current.height + drag.current.y - e.clientY);
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    resize(currentHeight() + (e.key === "ArrowUp" ? keyStepPx : -keyStepPx));
  };

  return (
    <I18nContext.Provider value={i18n}>
      <section
        className={styles.captions}
        aria-label={t("captions.title")}
        ref={(el) => {
          section.current = el;
          if (typeof ref === "function") return ref(el);
          if (ref) ref.current = el;
        }}
        style={
          {
            ...(height !== null && { "--captions-height": `${height}px` }),
            blockSize: `calc(var(--captions-height) + ${inset}px)`,
            "--captions-inset": `${inset}px`,
            marginBlockEnd: -inset,
          } as CSSProperties
        }
      >
        <div className={styles.panel}>
          <div
            className={styles.resizer}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("captions.resize")}
            aria-valuenow={height ?? undefined}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          />
          {segments.length === 0 ? (
            <div className={styles.list}>
              <Text size="sm" className={styles.waiting}>
                {listening ? t("captions.listening") : t("captions.waiting")}
              </Text>
            </div>
          ) : (
            <ol className={styles.list} ref={list} onScroll={onScroll}>
              {segments.map((caption, i) => {
                // Runs of one speaker's segments share a header, unless
                // they paused
                const prev = segments[i - 1];
                const continuation =
                  prev !== undefined &&
                  speakerOf(prev) === speakerOf(caption) &&
                  caption.event.getTs() - prev.event.getTs() < groupGapMs;
                return (
                  <li key={caption.event.getId()}>
                    <Segment {...caption} continuation={continuation} />
                  </li>
                );
              })}
            </ol>
          )}
          {scrolledUp && (
            <Button
              className={styles.jump}
              kind="primary"
              size="md"
              Icon={ChevronDownIcon}
              onClick={toLatest}
            >
              {t("captions.jump_to_latest")}
            </Button>
          )}
        </div>
      </section>
    </I18nContext.Provider>
  );
};
