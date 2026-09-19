/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, type Ref, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@vector-im/compound-web";
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
 * Live captions: the transcript the transcriber bot posts as a thread,
 * rendered as a list of message tiles above the call controls while
 * transcription is on.
 */
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
  const transcription = useBehavior(vm.transcription.transcription$);
  const segments = useBehavior(vm.transcription.segments$);
  // Keep the latest words in view as they arrive. (The shared TimelineView
  // is not used here: a few lines need no virtualising, and it never leaves
  // its loading state under React StrictMode.)
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [segments]);

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
          // Blank once the transcriber is in, until it has words for us
          transcription.rootId === null && (
            <div className={styles.list}>
              <Text size="sm" className={styles.waiting}>
                {t("captions.waiting")}
              </Text>
            </div>
          )
        ) : (
          <ol className={styles.list} ref={list}>
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
      </section>
    </I18nContext.Provider>
  );
};
