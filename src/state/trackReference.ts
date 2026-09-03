/*
Copyright 2023, 2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type TrackReference } from "@livekit/components-core";
import { type Participant, ParticipantEvent, type Track } from "livekit-client";

import { type Behavior, computed, fromEvents } from "./Behavior";
import { type ObservableScope } from "./ObservableScope";

/**
 * The participant events after which its track publications may have changed.
 */
export const PUBLICATION_EVENTS = [
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
] as const;

/**
 * The participant events after which its media (publications, mute states,
 * permissions) may have changed.
 */
export const MEDIA_EVENTS = [
  ...PUBLICATION_EVENTS,
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.ParticipantPermissionsChanged,
  ParticipantEvent.MediaDevicesError,
  ParticipantEvent.TrackSubscriptionStatusChanged,
] as const;

/**
 * A participant's track reference for a given media source.
 */
export function trackReference$(
  scope: ObservableScope,
  participant$: Behavior<Participant | null | undefined>,
  source: Track.Source,
): Behavior<TrackReference | undefined> {
  const publication$ = fromEvents(scope, participant$, MEDIA_EVENTS, (p) =>
    p?.getTrackPublication(source),
  );
  return computed(() => {
    const participant = participant$.value;
    const publication = publication$.value;
    return participant && publication
      ? { participant, publication, source }
      : undefined;
  });
}
