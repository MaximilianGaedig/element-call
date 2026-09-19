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

import { type Behavior, computed } from "./Behavior.ts";
import { type FloorControl, type SipDialIn } from "./FloorControl.ts";
import { inviteBot } from "./Recording.ts";
import { type Scope } from "./Scope.ts";

// Dial-in: moderators let people join the call over SIP by inviting a
// bridge bot and asking it for the call's addresses. See
// docs/floor_control_msc.md, "Discovering bridged addresses".

export const BridgeInfoRequestEventType = "org.matrix.rtc.bridge_info.request";
export const BridgeInfoEventType = "org.matrix.rtc.bridge_info";

export interface BridgeInfoContent {
  room_id: string;
  sip?: string[];
}

export interface DialIn {
  /** Whether dial-in is allowed, and with what media. */
  mode$: Behavior<SipDialIn | undefined>;
  /** The SIP addresses that dial into the call, from every bridge. */
  addresses$: Behavior<string[]>;
  /**
   * Allows or forbids dial-in. Null if the local user may not moderate or
   * no bridge is configured. Allowing it invites the bridge and asks it for
   * the call's addresses, which land in floor control when it answers.
   */
  setMode$: Behavior<((mode: SipDialIn | undefined) => Promise<void>) | null>;
}

export function createDialIn(
  scope: Scope,
  room: MatrixRoom,
  floorControl: FloorControl,
  bridge: string | undefined,
): DialIn {
  const mode$ = computed(() => floorControl.content$.value.sip_dial_in);
  const addresses$ = computed(() =>
    Object.values(floorControl.content$.value.bridges ?? {}).flatMap(
      (b) => b.sip ?? [],
    ),
  );

  // Only the configured bridge is believed, and only about this room; the
  // answer is written into floor control by whoever asked (a moderator)
  const onToDevice = (event: MatrixEvent): void => {
    if (
      bridge === undefined ||
      event.getType() !== BridgeInfoEventType ||
      event.getSender() !== bridge
    )
      return;
    const { room_id: roomId, sip } = event.getContent<BridgeInfoContent>();
    if (roomId === room.roomId && floorControl.canModerate$.peek())
      void floorControl.setBridge(bridge, { sip: sip ?? [] });
  };
  room.client.on(ClientEvent.ToDeviceEvent, onToDevice);
  scope.onEnd(() => room.client.off(ClientEvent.ToDeviceEvent, onToDevice));

  const setMode = async (mode: SipDialIn | undefined): Promise<void> => {
    await floorControl.setSipDialIn(mode);
    if (mode === undefined) return;
    // setMode$ only offers this once a bridge is configured
    await inviteBot(room, bridge!);
    await room.client.sendToDevice(
      BridgeInfoRequestEventType,
      new Map([[bridge!, new Map([["*", { room_id: room.roomId }]])]]),
    );
  };

  return {
    mode$,
    addresses$,
    setMode$: computed(() =>
      bridge !== undefined && floorControl.canModerate$.value ? setMode : null,
    ),
  };
}
