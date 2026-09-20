/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  ClientEvent,
  type MatrixEvent,
  type Room as MatrixRoom,
} from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior, computed } from "./Behavior.ts";
import { type LayoutMode } from "./LayoutSwitchViewModel.ts";
import { type RecordingState, sendEncryptedToDevice } from "./Recording.ts";
import { type Scope } from "./Scope.ts";

/**
 * To-device message carrying one layout decision from the director of a
 * recording to the recorder. See docs/call_layout_mirroring.md.
 */
export const LayoutEventType = "io.element.call.layout";

/** A tile, by whose stream it shows. */
export interface TileRef {
  user_id: string;
  device_id: string;
  /** Which of the device's streams; the camera when absent. */
  media?: "camera" | "screen_share";
  /** The published track, when a device has several of that kind. */
  track?: string;
}

/** Something the director did to their layout. */
export type LayoutOp =
  | { type: "layout"; layout: LayoutMode }
  | { type: "spotlight_expanded"; expanded: boolean }
  | ({ type: "move_tile"; index: number; in?: "grid" | "spotlight" } & TileRef)
  | ({ type: "pin"; pinned: boolean } & TileRef)
  | ({ type: "enlarge"; enlarged: boolean } & TileRef)
  | {
      type: "tile_options";
      hug_video?: boolean;
      crop_video?: boolean;
      relaxed_grid?: boolean;
      enlarge_active_speakers?: boolean;
    }
  | { type: "rail_width"; width: number }
  | ({ type: "volume"; volume: number } & TileRef);

export interface LayoutEventContent {
  room_id: string;
  /** The recording request this belongs to. */
  request: string;
  /** The director's device. */
  device_id: string;
  /** Counts up from 1 per recording; the recorder ignores anything late. */
  seq: number;
  op: LayoutOp;
}

/** Where the director keeps the last `seq` it used, and for which request. */
const seqKey = "layout-mirror-seq";

/** Ops that arrive in a stream while the user drags, sent settled. */
const coalesced = new Set<LayoutOp["type"]>(["volume", "rail_width"]);
const COALESCE_MS = 250;

/** What the local user did to their layout, as it happens. */
export interface LayoutOps {
  emit: (op: LayoutOp) => void;
  subscribe: (listener: (op: LayoutOp) => void) => () => void;
}

export function createLayoutOps(): LayoutOps {
  const listeners = new Set<(op: LayoutOp) => void>();
  return {
    emit: (op) => {
      for (const l of listeners) l(op);
    },
    subscribe: (l) => {
      listeners.add(l);
      return (): void => {
        listeners.delete(l);
      };
    },
  };
}

export interface LayoutMirrorInputs {
  recording$: Behavior<RecordingState | null>;
  /** The devices the recorder has in the call. */
  recorderDevices$: Behavior<string[]>;
  /** The local user's layout decisions, to direct with. */
  ops: LayoutOps;
  /** The local user's current decisions, for a recorder catching up. */
  snapshot: () => LayoutOp[];
  /** Does to the local layout what the director did to theirs. */
  apply: (op: LayoutOp) => void;
}

export interface LayoutMirror {
  /** Whether this device is directing the recording's layout. */
  directing$: Behavior<boolean>;
  /** Whether this device is the recorder, following a director. */
  following$: Behavior<boolean>;
}

/** The key two ops of a coalesced type replace each other under. */
function coalesceKey(op: LayoutOp): string {
  return "user_id" in op
    ? `${op.type}:${op.user_id}:${op.device_id}:${op.media ?? "camera"}:${op.track ?? ""}`
    : op.type;
}

/**
 * Mirrors layout decisions between whoever directs a recording and the
 * recorder: as the director, sends each decision the local user makes to
 * the recorder; as the recorder, applies the director's. For an audio
 * recording only the volumes are sent.
 */
export function createLayoutMirror(
  scope: Scope,
  room: MatrixRoom,
  { recording$, recorderDevices$, ops, snapshot, apply }: LayoutMirrorInputs,
): LayoutMirror {
  const userId = room.client.getUserId()!;
  const deviceId = room.client.getDeviceId()!;

  const directing$ = computed(() => {
    const r = recording$.value;
    return r !== null && r.by === userId && r.directorDevice === deviceId;
  });
  const following$ = computed(() => {
    const r = recording$.value;
    return (
      r !== null && r.recorder === userId && r.directorDevice !== undefined
    );
  });

  // Directing. The count outlives a reload of the page, which would
  // otherwise start again below what the recorder has already seen
  let seq = 0;
  const loadSeq = (request: string): number => {
    try {
      const stored = JSON.parse(localStorage.getItem(seqKey) ?? "null") as {
        request?: unknown;
        seq?: unknown;
      } | null;
      if (stored?.request === request && typeof stored.seq === "number")
        return stored.seq;
    } catch {
      // No storage, or nonsense in it: count from the start
    }
    return 0;
  };
  const storeSeq = (request: string): void => {
    try {
      localStorage.setItem(seqKey, JSON.stringify({ request, seq }));
    } catch {
      // Without storage we only lose direction after a reload
    }
  };
  const send = async (op: LayoutOp): Promise<void> => {
    const r = recording$.peek();
    const devices = recorderDevices$.peek();
    if (r === null || devices.length === 0) return;
    // An audio recording has no layout, only levels
    if (r.media === "audio" && op.type !== "volume") return;
    const content: LayoutEventContent = {
      room_id: room.roomId,
      request: r.eventId,
      device_id: deviceId,
      seq: ++seq,
      op,
    };
    storeSeq(r.eventId);
    const targets = devices.map((d) => ({ userId: r.recorder, deviceId: d }));
    if (room.hasEncryptionStateEvent())
      await sendEncryptedToDevice(
        room,
        LayoutEventType,
        targets,
        content as unknown as Record<string, unknown>,
      );
    else
      await room.client.sendToDevice(
        LayoutEventType,
        new Map([[r.recorder, new Map(devices.map((d) => [d, content]))]]),
      );
  };
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  // One at a time: encrypting takes a while, and messages that overtook
  // each other would have the recorder drop the older as late
  let sending = Promise.resolve();
  const direct = (op: LayoutOp): void => {
    const go = (): void => {
      sending = sending
        .then(async () => send(op))
        .catch((e) => logger.warn("Failed to send layout op", op, e));
    };
    if (!coalesced.has(op.type)) return go();
    const key = coalesceKey(op);
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        go();
      }, COALESCE_MS),
    );
  };
  scope.effect(() => {
    if (!directing$.value) return;
    seq = loadSeq(recording$.peek()!.eventId);
    const unsubscribe = ops.subscribe(direct);
    return (): void => {
      unsubscribe();
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  });
  // The recorder joins after the director has arranged things, so once it
  // confirms it's recording and we know which devices to tell, catch it up
  // on everything so far. Anything the user did before then had nowhere to
  // go, and is in the snapshot.
  const reachable$ = computed(
    () =>
      directing$.value &&
      recording$.value?.started === true &&
      recorderDevices$.value.length > 0,
  );
  scope.effect(() => {
    if (reachable$.value) for (const op of snapshot()) direct(op);
  });

  // Following
  let lastSeq = 0;
  scope.effect(() => {
    if (!following$.value) return;
    lastSeq = 0;
    const onToDevice = (event: MatrixEvent): void => {
      const r = recording$.peek();
      if (event.getType() !== LayoutEventType || r === null) return;
      // In an encrypted room only an encrypted message reaches us, since
      // the widget host drops the rest, so the sender is who it says
      const content = event.getContent<Partial<LayoutEventContent>>();
      if (
        event.getSender() !== r.by ||
        content.room_id !== room.roomId ||
        content.request !== r.eventId ||
        content.device_id !== r.directorDevice ||
        typeof content.seq !== "number" ||
        content.seq <= lastSeq ||
        content.op === undefined
      )
        return;
      lastSeq = content.seq;
      try {
        apply(content.op);
      } catch (e) {
        logger.warn("Failed to apply layout op", content.op, e);
      }
    };
    room.client.on(ClientEvent.ToDeviceEvent, onToDevice);
    return (): void => {
      room.client.off(ClientEvent.ToDeviceEvent, onToDevice);
    };
  });

  return { directing$, following$ };
}
