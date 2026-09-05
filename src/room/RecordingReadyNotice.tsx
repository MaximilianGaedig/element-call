/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type MatrixClient } from "matrix-js-sdk";
import { Button, Text } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/lib/logger";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type RecordingUpload } from "../state/Recording";
import { useBehavior } from "../useBehavior";
import { widget } from "../widget";
import styles from "./RecordingReadyNotice.module.css";

/** Fetches a media file with our access token, since media needs auth */
async function fetchMedia(
  client: MatrixClient,
  mxc: string,
  signal?: AbortSignal,
  size?: { width: number; height: number },
): Promise<Blob> {
  const url = client.mxcUrlToHttp(
    mxc,
    size?.width,
    size?.height,
    size && "scale",
    false,
    true,
    true,
  );
  if (url === null) throw new Error(`Can't resolve ${mxc}`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
    signal,
  });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.blob();
}

function useThumbnail(
  client: MatrixClient,
  mxc: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (mxc === undefined) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    fetchMedia(client, mxc, abort.signal, { width: 320, height: 180 })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => logger.warn("Failed to load recording thumbnail", e));
    return (): void => {
      abort.abort();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [client, mxc]);
  return url;
}

interface Props {
  vm: CallViewModel;
  client: MatrixClient;
}

/**
 * Tells everyone in the call that a recording has been posted to the room,
 * with its thumbnail and a download button, since the standalone app has
 * no timeline to find it in. As a widget the host shows the room, so
 * nothing is shown.
 */
export const RecordingReadyNotice: FC<Props> = ({ vm, client }) => {
  const { t } = useTranslation();
  const uploads = useBehavior(vm.recording.uploads$);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const upload: RecordingUpload | undefined = uploads[uploads.length - 1];
  const thumbnail = useThumbnail(client, upload?.thumbnailUrl);
  if (widget !== null || upload === undefined || upload.eventId === dismissed)
    return null;

  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await fetchMedia(client, upload.url);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = upload.body || "recording";
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      logger.error("Failed to download recording", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={styles.notice} role="status">
      {thumbnail !== undefined && (
        <img className={styles.thumbnail} src={thumbnail} alt="" />
      )}
      <div className={styles.text}>
        <Text as="span" size="md" weight="semibold">
          {t("recording.ready")}
        </Text>
        <Text as="span" size="xs" className={styles.filename}>
          {upload.body}
        </Text>
      </div>
      <Button
        kind="primary"
        size="md"
        disabled={downloading}
        onClick={() => void download()}
      >
        {t("recording.download")}
      </Button>
      <Button
        kind="secondary"
        size="md"
        onClick={() => setDismissed(upload.eventId)}
      >
        {t("action.close")}
      </Button>
    </div>
  );
};
