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
import { Modal } from "../Modal";
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
  const count = recording.awaitingConsent.length;
  const label = recording.started
    ? t("recording.in_progress", { name, userId: recording.by })
    : count > 0
      ? t("recording.awaiting_consent", { name, userId: recording.by, count })
      : t("recording.starting", { name, userId: recording.by });
  return (
    <Tooltip label={label}>
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
 * until acknowledged. When the recording needs everyone's consent, it's a
 * dialog asking for it instead, which stays until answered either way.
 */
export const RecordingNotice: FC<NoticeProps> = ({ vm, room, localUserId }) => {
  const { t } = useTranslation();
  const recording = useBehavior(vm.recording.recording$);
  // The recording (by event ID) whose notice has been acknowledged
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  if (recording === null) return null;
  if (
    recording.by === localUserId ||
    acknowledged === recording.eventId ||
    recording.consents[localUserId] !== undefined
  )
    return null;

  const name = room.getMember(recording.by)?.rawDisplayName ?? recording.by;
  if (recording.requiresConsent)
    return (
      <Modal title={t("recording.consent_title", { name })} open>
        <Text>{t("recording.consent_body")}</Text>
        <div className={styles.buttons}>
          <Button
            kind="secondary"
            onClick={() => void vm.recording.consent(false)}
          >
            {t("recording.consent_decline")}
          </Button>
          <Button
            kind="primary"
            onClick={() => void vm.recording.consent(true)}
          >
            {t("recording.consent_agree")}
          </Button>
        </div>
      </Modal>
    );
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
