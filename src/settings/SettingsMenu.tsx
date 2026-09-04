/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { cloneElement, type FC, type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, MenuItem } from "@vector-im/compound-web";
import {
  AdminIcon,
  SettingsSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

interface Props {
  /** The "..." button. */
  trigger: ReactElement<{ onClick?: () => void }>;
  openSettings: () => void;
  /** Set only for moderators. */
  openModeratorSettings: (() => void) | undefined;
}

/**
 * Makes the "..." button open the settings, or, for moderators, a menu
 * choosing between the user's own settings and the moderator settings.
 */
export const SettingsMenu: FC<Props> = ({
  trigger,
  openSettings,
  openModeratorSettings,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (openModeratorSettings === undefined)
    return cloneElement(trigger, { onClick: openSettings });

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      title={t("common.settings")}
      trigger={trigger}
      side="top"
      align="start"
    >
      <MenuItem
        Icon={SettingsSolidIcon}
        label={t("settings.user_settings")}
        onSelect={openSettings}
      />
      <MenuItem
        Icon={AdminIcon}
        label={t("settings.moderator_settings")}
        onSelect={openModeratorSettings}
      />
    </Menu>
  );
};
