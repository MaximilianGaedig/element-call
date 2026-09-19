/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CheckboxControl,
  InlineField,
  Label,
  Root as Form,
  Text,
} from "@vector-im/compound-web";

import { Modal } from "../Modal";
import { Config } from "../config/Config";
import { type RecordingOptions } from "../state/Recording";
import styles from "./RecordModal.module.css";

interface Props {
  open: boolean;
  onDismiss: () => void;
  /** Called with how to record when the user confirms. */
  onStart: (options: RecordingOptions) => void;
}

/**
 * Asks the user to confirm that they want to record the call, since it
 * warns everyone in it, whether to record audio only, whether everyone
 * must consent first, and whether the recorder should mirror their layout.
 */
export const RecordModal: FC<Props> = ({ open, onDismiss, onStart }) => {
  const { t } = useTranslation();
  const [audioOnly, setAudioOnly] = useState(false);
  // A deployment can insist on consent, in which case the option is shown
  // on but can't be changed
  const consentForced = Config.get().recording_requires_consent === true;
  const [requireConsent, setRequireConsent] = useState(consentForced);
  const [mirrorLayout, setMirrorLayout] = useState(false);
  return (
    <Modal
      title={t("recording.confirm_title")}
      open={open}
      onDismiss={onDismiss}
    >
      <Text>{t("recording.confirm_body")}</Text>
      <Form>
        <InlineField
          name="audioOnly"
          control={
            <CheckboxControl
              checked={audioOnly}
              onChange={(e) => setAudioOnly(e.target.checked)}
            />
          }
        >
          <Label>{t("recording.audio_only")}</Label>
        </InlineField>
        <InlineField
          name="requireConsent"
          control={
            <CheckboxControl
              checked={requireConsent}
              disabled={consentForced}
              onChange={(e) => setRequireConsent(e.target.checked)}
            />
          }
        >
          <Label>{t("recording.require_consent")}</Label>
        </InlineField>
        <InlineField
          name="mirrorLayout"
          control={
            <CheckboxControl
              checked={mirrorLayout && !audioOnly}
              // An audio recording has no layout
              disabled={audioOnly}
              onChange={(e) => setMirrorLayout(e.target.checked)}
            />
          }
        >
          <Label>{t("recording.mirror_layout")}</Label>
        </InlineField>
      </Form>
      <div className={styles.buttons}>
        <Button kind="secondary" onClick={onDismiss}>
          {t("action.cancel")}
        </Button>
        <Button
          kind="primary"
          destructive
          onClick={() =>
            onStart({
              audioOnly,
              requireConsent,
              mirrorLayout: mirrorLayout && !audioOnly,
            })
          }
          data-testid="record_confirm"
        >
          {t("recording.confirm_button")}
        </Button>
      </div>
    </Modal>
  );
};
