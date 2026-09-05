/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Room } from "matrix-js-sdk";
import { Button, Text } from "@vector-im/compound-web";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { useBehavior } from "../useBehavior";
import styles from "./RecordingIndicator.module.css";

interface Props {
  vm: CallViewModel;
  room: Room;
  localUserId: string;
}

/**
 * Tells the user that the call is being recorded: a "REC" badge in the
 * corner for as long as it lasts, and a notice naming who is recording that
 * stays until acknowledged. The person recording gets only the badge.
 */
export const RecordingIndicator: FC<Props> = ({ vm, room, localUserId }) => {
  const { t } = useTranslation();
  const recording = useBehavior(vm.recording.recording$);
  // The recording (by event ID) whose notice has been acknowledged
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  if (recording === null) return null;

  const showNotice =
    recording.by !== localUserId && acknowledged !== recording.eventId;
  const name = room.getMember(recording.by)?.rawDisplayName ?? recording.by;
  return (
    <>
      <div
        className={styles.badge}
        role="status"
        aria-label={t("recording.in_progress")}
      >
        {t("recording.badge")}
      </div>
      {showNotice && (
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
      )}
    </>
  );
};
