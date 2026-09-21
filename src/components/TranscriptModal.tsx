/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "@vector-im/compound-web";

import { Modal } from "../Modal";
import styles from "./RecordModal.module.css";

interface Props {
  open: boolean;
  /** Whether a transcript is being kept, and so the question is stopping it. */
  keeping: boolean;
  onDismiss: () => void;
  /** Called with whether the room should keep a transcript from here on. */
  onChoose: (keep: boolean) => void;
}

/**
 * Captions are only shown to whoever turns them on. A transcript is kept in
 * the room for everyone, so it's asked about separately: whether to start
 * one as captions go on, and whether to stop it as they go off.
 */
export const TranscriptModal: FC<Props> = ({
  open,
  keeping,
  onDismiss,
  onChoose,
}) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t(keeping ? "captions.stop_title" : "captions.keep_title")}
      open={open}
      onDismiss={onDismiss}
    >
      <Text>{t(keeping ? "captions.stop_body" : "captions.keep_body")}</Text>
      <div className={styles.buttons}>
        <Button
          kind="secondary"
          onClick={() => onChoose(keeping)}
          data-testid="transcript_unchanged"
        >
          {t(keeping ? "captions.stop_decline" : "captions.keep_decline")}
        </Button>
        <Button
          kind="primary"
          destructive={!keeping}
          onClick={() => onChoose(!keeping)}
          data-testid="transcript_change"
        >
          {t(keeping ? "captions.stop_confirm" : "captions.keep_confirm")}
        </Button>
      </div>
    </Modal>
  );
};
