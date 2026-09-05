/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { ClientEvent, type MatrixEvent, type Room } from "matrix-js-sdk";

import {
  BridgeInfoEventType,
  BridgeInfoRequestEventType,
  createDialIn,
} from "./DialIn.ts";
import { constant } from "./Behavior.ts";
import { type FloorControl } from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";

const bridge = "@sip:e";

describe("createDialIn", () => {
  it("invites the bridge, asks it for addresses and records its answer", async () => {
    const sendToDevice = vi.fn().mockResolvedValue({});
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = { ...mockEmitter(), sendToDevice, sendStateEvent };
    const room = {
      roomId: "!room",
      client,
      getMember: () => null,
    } as unknown as Room;
    const floorControl = {
      content$: constant({ bridges: { [bridge]: { sip: ["sip:a@b"] } } }),
      canModerate$: constant(true),
      setSipDialIn: vi.fn().mockResolvedValue(undefined),
      setBridge: vi.fn().mockResolvedValue(undefined),
    } as unknown as FloorControl;
    const dialIn = createDialIn(testScope(), room, floorControl, bridge);
    expect(dialIn.addresses$.value).toEqual(["sip:a@b"]);

    await dialIn.setMode$.value!("video");
    expect(floorControl.setSipDialIn).toHaveBeenCalledWith("video");
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      "m.room.member",
      { membership: "invite" },
      bridge,
    );
    expect(sendToDevice).toHaveBeenCalledWith(
      BridgeInfoRequestEventType,
      new Map([[bridge, new Map([["*", { room_id: "!room" }]])]]),
    );

    client.emit(ClientEvent.ToDeviceEvent, {
      getType: () => BridgeInfoEventType,
      getSender: () => bridge,
      getContent: () => ({ room_id: "!room", sip: ["sip:c@d"] }),
    } as unknown as MatrixEvent);
    expect(floorControl.setBridge).toHaveBeenCalledWith(bridge, {
      sip: ["sip:c@d"],
    });
  });
});
