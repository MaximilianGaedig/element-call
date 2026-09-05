/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@vector-im/compound-web";

import styles from "./DialInAddresses.module.css";

interface Props {
  addresses: string[];
}

/** The SIP addresses that dial into the call, or that they're still coming */
export const DialInAddresses: FC<Props> = ({ addresses }) => {
  const { t } = useTranslation();
  return addresses.length === 0 ? (
    <Text size="sm" className={styles.waiting}>
      {t("settings.dial_in.waiting")}
    </Text>
  ) : (
    <ul className={styles.list}>
      {addresses.map((address) => (
        <li key={address}>
          <Text as="span" size="sm">
            <a href={address}>{address}</a>
          </Text>
        </li>
      ))}
    </ul>
  );
};
