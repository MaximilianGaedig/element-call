/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { type Room } from "matrix-js-sdk";
import { Button, Root as Form, Separator, Text } from "@vector-im/compound-web";

import { Modal } from "../Modal";
import { FieldRow, InputField } from "../input/Input";
import {
  type DeviceControlContent,
  type FloorControl,
} from "../state/FloorControl.ts";
import { useBehavior } from "../useBehavior";
import styles from "./ModeratorSettingsModal.module.css";

interface Props {
  open: boolean;
  onDismiss: () => void;
  floorControl: FloorControl;
  room: Room;
}

/**
 * Splits a media ID into its user and device. The user ID has a ':' of its
 * own (and another if its server name carries a port), so split at the last
 * one, which assumes the device ID contains none. Servers generate device IDs
 * without one; a client-chosen device ID with a ':' would be misread here.
 */
export function splitMediaId(id: string): [userId: string, deviceId: string] {
  const i = id.lastIndexOf(":");
  return [id.slice(0, i), id.slice(i + 1)];
}

interface RemovableListProps {
  title: string;
  empty: string;
  action: string;
  /** Entries in floor control to list, by media ID. */
  entries: [id: string, entry: DeviceControlContent][];
  room: Room;
  onRemove: (id: string, userId: string) => void;
}

/**
 * Lists devices some control applies to, each with a button to lift it. Used
 * for controls that remove the tile from view, which therefore can't be lifted
 * from the tile's own menu.
 */
const RemovableList: FC<RemovableListProps> = ({
  title,
  empty,
  action,
  entries,
  room,
  onRemove,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Separator />
      <Text as="h4" size="md" weight="semibold">
        {title}
      </Text>
      {entries.length === 0 ? (
        <Text size="sm" className={styles.empty}>
          {empty}
        </Text>
      ) : (
        <ul className={styles.list}>
          {entries.map(([id]) => {
            const [userId, deviceId] = splitMediaId(id);
            const name = room.getMember(userId)?.rawDisplayName ?? userId;
            return (
              <li key={id} className={styles.item}>
                <Text as="span" size="sm">
                  {name}
                  <span className={styles.device}>
                    {userId} ·{" "}
                    {deviceId === "*"
                      ? t("settings.moderator.all_devices")
                      : deviceId}
                  </span>
                </Text>
                <Button
                  kind="secondary"
                  size="md"
                  onClick={() => onRemove(id, userId)}
                >
                  {action}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

/**
 * Settings only moderators can change: the floor control defaults that apply
 * to everyone in the call.
 */
export const ModeratorSettingsModal: FC<Props> = ({
  open,
  onDismiss,
  floorControl,
  room,
}) => {
  const { t } = useTranslation();
  const content = useBehavior(floorControl.content$);
  const entries = Object.entries(content.devices ?? {});
  const defaults = content.defaults ?? {};
  const usersDefault = useBehavior(floorControl.usersDefault$);
  const visibility = content.auditorium_visibility;
  const recordingLevel = useBehavior(floorControl.recordingLevel$);
  const canSetRecordingLevel = useBehavior(floorControl.canSetRecordingLevel$);

  // The same choice of levels Element Web offers, plus what unset means for
  // the setting, plus whatever custom level might already be set
  const levelOptions = (
    unset: string,
    current: number | undefined,
  ): { value: number | undefined; label: string }[] => {
    const levels = [
      { value: undefined, label: unset },
      { value: usersDefault, label: t("power_level.default") },
      { value: 50, label: t("power_level.moderator") },
      { value: 100, label: t("power_level.admin") },
    ];
    if (current !== undefined && !levels.some(({ value }) => value === current))
      levels.push({
        value: current,
        label: t("power_level.custom", { level: current }),
      });
    return levels;
  };
  const levels = levelOptions(
    t("settings.moderator.auditorium_off"),
    visibility,
  );
  const recordingLevels = levelOptions(
    t("power_level.moderator"),
    recordingLevel,
  );

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
        {canSetRecordingLevel && (
          <FieldRow>
            <label htmlFor="recordingLevel">
              {t("settings.moderator.recording_level_label")}
            </label>
            <select
              id="recordingLevel"
              value={recordingLevel ?? ""}
              onChange={(e): void =>
                void floorControl.setRecordingLevel(
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            >
              {recordingLevels.map(({ value, label }) => (
                <option key={value ?? ""} value={value ?? ""}>
                  {label}
                </option>
              ))}
            </select>
          </FieldRow>
        )}
      </Form>
      <RemovableList
        title={t("settings.moderator.hidden_heading")}
        empty={t("settings.moderator.none_hidden")}
        action={t("settings.moderator.show")}
        entries={entries.filter(([, entry]) => entry.hidden)}
        room={room}
        onRemove={(id, userId) =>
          void floorControl.setDevice(id, userId, { hidden: false })
        }
      />
      <RemovableList
        title={t("settings.moderator.blocked_heading")}
        empty={t("settings.moderator.none_blocked")}
        action={t("settings.moderator.unblock")}
        entries={entries.filter(([, entry]) => entry.blocked)}
        room={room}
        onRemove={(id, userId) =>
          void floorControl.setDevice(id, userId, { blocked: false })
        }
      />
    </Modal>
  );
};
