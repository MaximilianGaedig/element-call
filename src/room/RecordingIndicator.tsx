/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Room } from "matrix-js-sdk";
import { Button, Text, Tooltip } from "@vector-im/compound-web";
import classNames from "classnames";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { useBehavior } from "../useBehavior";
import styles from "./RecordingIndicator.module.css";

interface BadgeProps {
  vm: CallViewModel;
  room: Room;
  /** Float in the corner, for views without a header to sit in */
  floating?: boolean;
}

/**
 * A "REC" light shown for as long as the call is being recorded, grey until
 * the recorder confirms that it's started. Lives in the header beside the
 * Invite button, or floats in the corner when there's no header.
 */
export const RecordingBadge: FC<BadgeProps> = ({ vm, room, floating }) => {
  const { t } = useTranslation();
  const recording = useBehavior(vm.recording.recording$);
  if (recording === null) return null;

  const name = room.getMember(recording.by)?.rawDisplayName ?? recording.by;
  return (
    <Tooltip
      label={t(
        recording.started ? "recording.in_progress" : "recording.starting",
        { name, userId: recording.by },
      )}
    >
      <div
        className={classNames(styles.badge, {
          [styles.floating]: floating,
          [styles.pending]: !recording.started,
        })}
        role="status"
        aria-busy={!recording.started}
      >
        {t("recording.badge")}
      </div>
    </Tooltip>
  );
};

interface NoticeProps {
  vm: CallViewModel;
  room: Room;
  localUserId: string;
}

/**
 * A notice naming who is recording the call, shown to everyone but them
 * until acknowledged.
 */
export const RecordingNotice: FC<NoticeProps> = ({ vm, room, localUserId }) => {
  const { t } = useTranslation();
  const recording = useBehavior(vm.recording.recording$);
  // The recording (by event ID) whose notice has been acknowledged
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  if (recording === null) return null;
  if (recording.by === localUserId || acknowledged === recording.eventId)
    return null;

  const name = room.getMember(recording.by)?.rawDisplayName ?? recording.by;
  return (
    <div className={styles.notice} role="alert">
      <Text as="span" size="md" weight="semibold">
        {t("recording.notice", { name })}
      </Text>
      <Button
        kind="secondary"
        size="md"
        onClick={() => setAcknowledged(recording.eventId)}
      >
        {t("recording.acknowledge")}
      </Button>
    </div>
  );
};
