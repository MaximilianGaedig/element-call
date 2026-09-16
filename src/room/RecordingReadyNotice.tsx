/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type MatrixClient } from "matrix-js-sdk";
import { Button, InlineSpinner, Text } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/lib/logger";
import { decryptAttachment } from "matrix-encrypt-attachment";

import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { type MediaFile, type RecordingUpload } from "../state/Recording";
import { useBehavior } from "../useBehavior";
import { widget } from "../widget";
import styles from "./RecordingReadyNotice.module.css";

/** Fetches a media file with our access token, decrypting it if need be */
async function fetchMedia(
  client: MatrixClient,
  file: MediaFile,
  signal?: AbortSignal,
  size?: { width: number; height: number },
): Promise<Blob> {
  // The server can't thumbnail encrypted files, so take them whole
  const scale = size !== undefined && file.encrypted === undefined;
  const url = client.mxcUrlToHttp(
    file.url,
    scale ? size.width : undefined,
    scale ? size.height : undefined,
    scale ? "scale" : undefined,
    false,
    true,
    true,
  );
  if (url === null) throw new Error(`Can't resolve ${file.url}`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
    signal,
  });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  if (file.encrypted === undefined) return response.blob();
  return new Blob([
    await decryptAttachment(await response.arrayBuffer(), file.encrypted),
  ]);
}

function useThumbnail(
  client: MatrixClient,
  file: MediaFile | undefined,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (file === undefined) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    // The notice shows the thumbnail at 96×54 CSS pixels; ask for a 16:9
    // thumbnail a few times that so it stays sharp on high-density screens
    fetchMedia(client, file, abort.signal, { width: 320, height: 180 })
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
  }, [client, file]);
  return url;
}

interface Props {
  vm: CallViewModel;
  client: MatrixClient;
}

/**
 * Tells everyone in the call that a recording has been posted to the room,
 * with its thumbnail and a download button, since the standalone app has
 * no timeline to find it in. Whoever stopped the recording sees the notice
 * straight away, with a spinner until the recorder has posted it. As a
 * widget the host shows the room, so nothing is shown.
 */
export const RecordingReadyNotice: FC<Props> = ({ vm, client }) => {
  const { t } = useTranslation();
  const uploads = useBehavior(vm.recording.uploads$);
  const finishing = useBehavior(vm.recording.finishing$);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const upload: RecordingUpload | undefined = uploads[uploads.length - 1];
  const thumbnail = useThumbnail(client, upload?.thumbnail);
  if (widget !== null) return null;
  if (finishing) {
    if (dismissed === "finishing") return null;
    return (
      <div className={styles.notice} role="status">
        <InlineSpinner size={24} />
        <div className={styles.text}>
          <Text as="span" size="md" weight="semibold">
            {t("recording.finishing")}
          </Text>
        </div>
        <Button
          kind="secondary"
          size="md"
          onClick={() => setDismissed("finishing")}
        >
          {t("action.close")}
        </Button>
      </div>
    );
  }
  if (upload === undefined || upload.eventId === dismissed) return null;

  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await fetchMedia(client, upload.file);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = upload.body || "recording";
      a.click();
      // The browser reads the blob URL asynchronously once the download
      // starts, so keep it alive for a while rather than revoking at once
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
