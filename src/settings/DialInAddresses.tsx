/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@vector-im/compound-web";

import styles from "./DialInAddresses.module.css";
import { type DialInAddresses as Addresses } from "../state/DialIn.ts";

interface Props {
  addresses: Addresses;
}

export const DialInAddresses: FC<Props> = ({ addresses }) => {
  const { t } = useTranslation();
  return addresses.sip.length === 0 && addresses.phone.length === 0 ? (
    <Text size="sm" className={styles.waiting}>
      {t("settings.dial_in.waiting")}
    </Text>
  ) : (
    <ul className={styles.list}>
      {addresses.sip.map((address) => (
        <li key={address}>
          <Text as="span" size="sm">
            <a href={address}>{address}</a>
          </Text>
        </li>
      ))}
      {addresses.phone.map(({ number, code }) => (
        <li key={number}>
          <Text as="span" size="sm">
            <a href={number}>{number.replace(/^tel:/, "")}</a>{" "}
            {t("settings.dial_in.phone_code", { code })}
          </Text>
        </li>
      ))}
    </ul>
  );
};
