/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Root as Form } from "@vector-im/compound-web";

import { Modal } from "../Modal";
import { FieldRow, InputField } from "../input/Input";
import { type FloorControl } from "../state/FloorControl.ts";
import { useBehavior } from "../useBehavior";

interface Props {
  open: boolean;
  onDismiss: () => void;
  floorControl: FloorControl;
}

/**
 * Settings only moderators can change: the floor control defaults that apply
 * to everyone in the call.
 */
export const ModeratorSettingsModal: FC<Props> = ({
  open,
  onDismiss,
  floorControl,
}) => {
  const { t } = useTranslation();
  const content = useBehavior(floorControl.content$);
  const defaults = content.defaults ?? {};
  const usersDefault = useBehavior(floorControl.usersDefault$);
  const visibility = content.auditorium_visibility;

  // The same choice of levels Element Web offers, plus off, plus whatever
  // custom level might already be set
  const levels: { value: number | undefined; label: string }[] = [
    { value: undefined, label: t("settings.moderator.auditorium_off") },
    { value: usersDefault, label: t("power_level.default") },
    { value: 50, label: t("power_level.moderator") },
    { value: 100, label: t("power_level.admin") },
  ];
  if (
    visibility !== undefined &&
    !levels.some(({ value }) => value === visibility)
  )
    levels.push({
      value: visibility,
      label: t("power_level.custom", { level: visibility }),
    });

  return (
    <Modal
      title={t("settings.moderator_settings")}
      open={open}
      onDismiss={onDismiss}
    >
      <Form>
        <FieldRow>
          <InputField
            id="moderatorMuteAudioByDefault"
            type="checkbox"
            label={t("settings.moderator.mute_audio_by_default")}
            checked={defaults.audio_muted ?? false}
            onChange={(e): void =>
              void floorControl.setDefaults({ audio_muted: e.target.checked })
            }
          />
        </FieldRow>
        <FieldRow>
          <InputField
            id="moderatorMuteVideoByDefault"
            type="checkbox"
            label={t("settings.moderator.mute_video_by_default")}
            description={t("settings.moderator.defaults_description")}
            checked={defaults.video_muted ?? false}
            onChange={(e): void =>
              void floorControl.setDefaults({ video_muted: e.target.checked })
            }
          />
        </FieldRow>
        <FieldRow>
          <label htmlFor="auditoriumVisibility">
            {t("settings.moderator.auditorium_label")}
          </label>
          <select
            id="auditoriumVisibility"
            value={visibility ?? ""}
            onChange={(e): void =>
              void floorControl.setAuditoriumVisibility(
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          >
            {levels.map(({ value, label }) => (
              <option key={value ?? ""} value={value ?? ""}>
                {label}
              </option>
            ))}
          </select>
        </FieldRow>
      </Form>
    </Modal>
  );
};
