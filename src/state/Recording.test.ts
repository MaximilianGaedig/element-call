/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import {
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

import {
  CONFIRM_TIMEOUT_MS,
  ConsentDeclinedError,
  consentOnJoin,
  createRecording,
  RecorderError,
  RecordingConsentKey,
  type RecordingEventContent,
  RecordingStatusEventType,
} from "./Recording.ts";
import { constant, state } from "./Behavior.ts";
import { type FloorControl, RecordingEventType } from "./FloorControl.ts";
import { mockEmitter, testScope } from "../utils/test.ts";
import { E2eeType } from "../e2ee/e2eeType.ts";

const slot = "m.call#ROOM";
const bot = "@bot:e";

function event(
  sender: string,
  content: RecordingEventContent,
  id: string,
): MatrixEvent {
  return {
    getContent: () => content,
    getSender: () => sender,
    getId: () => id,
  } as unknown as MatrixEvent;
}

function setup(botMembership?: string): {
  room: Room;
  sendStateEvent: ReturnType<typeof vi.fn>;
  set: (event: MatrixEvent | null) => void;
} {
  let current: MatrixEvent | null = null;
  const sendStateEvent = vi.fn().mockResolvedValue({});
  const room = {
    ...mockEmitter(),
    roomId: "!room",
    client: { sendStateEvent, getUserId: () => "@alice:e" },
    currentState: {
      getStateEvents: (type: string, key: string) =>
        type === RecordingEventType && key === slot ? current : null,
    },
    getMember: (userId: string) =>
      userId === bot && botMembership !== undefined
        ? { membership: botMembership }
        : null,
  } as unknown as Room;
  return {
    room,
    sendStateEvent,
    set: (event) => {
      current = event;
      room.emit(RoomStateEvent.Update, null!);
    },
  };
}

const canRecord = { canRecord$: constant(true) } as unknown as FloorControl;
const none = { kind: E2eeType.NONE } as const;
const noBots = constant(new Set<string>());

/** A call membership, with the user's answers to consent requests */
function member(
  userId: string,
  consents?: Record<string, unknown>,
): {
  userId: string;
  applicationData: { type: string; [key: string]: unknown };
} {
  return {
    userId,
    applicationData: {
      type: "m.call",
      ...(consents === undefined ? {} : { [RecordingConsentKey]: consents }),
    },
  };
}
const people = constant([
  member("@alice:e"),
  member("@bob:e"),
  member("@carol:e"),
]);
const rtcSession = { updateApplicationData: vi.fn() };

describe("createRecording", () => {
  it("reports the recording from room state", () => {
    const { room, set } = setup();
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    expect(r.recording$.value).toBeNull();
    set(event("@alice:e", { recorder: bot, media: "audio" }, "$1"));
    expect(r.recording$.value).toEqual({
      by: "@alice:e",
      recorder: bot,
      media: "audio",
      streams: "composite",
      eventId: "$1",
      started: false,
      requiresConsent: false,
      consents: {},
      awaitingConsent: [],
    });
    set(event("@alice:e", {}, "$2"));
    expect(r.recording$.value).toBeNull();
  });

  it("invites the recorder before asking it to start, and stops by clearing", async () => {
    const { room, sendStateEvent, set } = setup();
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    await r.toggle$.value!();
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      1,
      "!room",
      "m.room.member",
      { membership: "invite" },
      bot,
    );
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      2,
      "!room",
      RecordingEventType,
      { recorder: bot },
      slot,
    );
    set(event("@me:e", { recorder: bot }, "$1"));
    await r.toggle$.value!();
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      RecordingEventType,
      {},
      slot,
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
  });

  it("hands the recorder the call's shared key before asking", async () => {
    const { room, sendStateEvent } = setup();
    const batch = { batch: [] };
    const encryptToDeviceMessages = vi.fn().mockResolvedValue(batch);
    const queueToDevice = vi.fn().mockResolvedValue(undefined);
    Object.assign(room.client, {
      queueToDevice,
      getCrypto: () => ({
        getUserDeviceInfo: vi
          .fn()
          .mockResolvedValue(new Map([[bot, new Map([["DEV1", {}]])]])),
        encryptToDeviceMessages,
      }),
    });
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      { kind: E2eeType.SHARED_KEY, secret: "hunter2" },
      rtcSession,
      people,
      noBots,
    );
    await r.toggle$.value!();
    expect(encryptToDeviceMessages).toHaveBeenCalledWith(
      "io.element.call.shared_key",
      [{ userId: bot, deviceId: "DEV1" }],
      { room_id: "!room", key: "hunter2" },
    );
    expect(queueToDevice).toHaveBeenCalledWith(batch);
    expect(queueToDevice.mock.invocationCallOrder[0]).toBeLessThan(
      sendStateEvent.mock.invocationCallOrder[1],
    );
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      RecordingEventType,
      { recorder: bot },
      slot,
    );
  });

  it("asks for audio only when told to", async () => {
    const { room, sendStateEvent } = setup("join");
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    await r.toggle$.value!({ audioOnly: true });
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      "!room",
      RecordingEventType,
      { recorder: bot, media: "audio" },
      slot,
    );
  });

  it("reports a failed request instead of throwing", async () => {
    const { room, sendStateEvent } = setup();
    sendStateEvent.mockRejectedValueOnce(new Error("429"));
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    await r.toggle$.value!();
    expect(r.error$.value?.message).toBe("429");
    expect(r.recording$.value).toBeNull();
  });

  it("doesn't invite a recorder that's already in the room", async () => {
    const { room, sendStateEvent } = setup("join");
    await createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    ).toggle$.value!();
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it("offers nothing without a recorder or the power to record", () => {
    const { room } = setup();
    expect(
      createRecording(
        testScope(),
        room,
        canRecord,
        slot,
        undefined,
        none,
        rtcSession,
        people,
        noBots,
      ).toggle$.value,
    ).toBeNull();
    const cannot = { canRecord$: constant(false) } as unknown as FloorControl;
    expect(
      createRecording(
        testScope(),
        room,
        cannot,
        slot,
        bot,
        none,
        rtcSession,
        people,
        noBots,
      ).toggle$.value,
    ).toBeNull();
  });

  it("waits for the recorder to confirm, and reports its failures", () => {
    const { room, set, sendStateEvent } = setup();
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    set(event("@alice:e", { recorder: bot }, "$req"));
    expect(r.recording$.value?.started).toBe(false);
    const status = (content: object): void =>
      void room.emit(
        RoomEvent.Timeline,
        {
          getSender: () => bot,
          getType: () => RecordingStatusEventType,
          getContent: () => content,
          getRelation: () => ({ rel_type: "m.reference", event_id: "$req" }),
          getId: () => "$status",
        } as unknown as MatrixEvent,
        room,
        false,
        false,
        null!,
      );
    status({ status: "failed", reason: "no call" });
    expect(r.error$.value).toBeInstanceOf(RecorderError);
    expect(r.error$.value?.message).toBe("no call");
    // We asked, so we clear the request
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      RecordingEventType,
      {},
      slot,
    );
    status({ status: "started" });
    expect(r.recording$.value?.started).toBe(true);
  });

  it("gives up if the recorder doesn't confirm in time", () => {
    vi.useFakeTimers();
    try {
      const { room, set, sendStateEvent } = setup();
      const r = createRecording(
        testScope(),
        room,
        canRecord,
        slot,
        bot,
        none,
        rtcSession,
        people,
        noBots,
      );
      // Somebody else's request isn't ours to give up on
      set(event("@bob:e", { recorder: bot }, "$theirs"));
      vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS);
      expect(sendStateEvent).not.toHaveBeenCalled();
      set(event("@alice:e", { recorder: bot }, "$ours"));
      vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1);
      expect(sendStateEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(r.error$.value).toBeInstanceOf(RecorderError);
      expect(sendStateEvent).toHaveBeenCalledWith(
        "!room",
        RecordingEventType,
        {},
        slot,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("collects recordings the recorder posts", () => {
    const { room } = setup();
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      people,
      noBots,
    );
    const upload = (sender: string, content: object, id: string): void =>
      void room.emit(
        RoomEvent.Timeline,
        {
          getSender: () => sender,
          getType: () => "m.room.message",
          getContent: () => content,
          getId: () => id,
        } as unknown as MatrixEvent,
        room,
        false,
        false,
        null!,
      );
    upload("@alice:e", { msgtype: "m.video", url: "mxc://e/x" }, "$0");
    upload(bot, { msgtype: "m.notice", body: "Recording started." }, "$1");
    upload(
      bot,
      {
        msgtype: "m.video",
        body: "call.webm",
        url: "mxc://e/v",
        info: { thumbnail_url: "mxc://e/t" },
      },
      "$2",
    );
    // An encrypted upload, which only shows up once decrypted
    const encrypted = { url: "mxc://e/enc", key: {}, iv: "", hashes: {} };
    let decrypted: ((event: MatrixEvent) => void) | undefined;
    const event = {
      getSender: () => bot,
      getType: () => "m.room.encrypted",
      getContent: () => ({
        msgtype: "m.video",
        body: "secret.webm",
        file: encrypted,
        info: { thumbnail_file: encrypted },
      }),
      getId: () => "$3",
      once: (_name: string, f: (event: MatrixEvent) => void) => {
        decrypted = f;
      },
    } as unknown as MatrixEvent;
    room.emit(RoomEvent.Timeline, event, room, false, false, null!);
    expect(r.uploads$.value).toHaveLength(1);
    decrypted!(event);
    expect(r.uploads$.value).toEqual([
      {
        eventId: "$2",
        msgtype: "m.video",
        body: "call.webm",
        file: { url: "mxc://e/v" },
        thumbnail: { url: "mxc://e/t" },
      },
      {
        eventId: "$3",
        msgtype: "m.video",
        body: "secret.webm",
        file: { url: "mxc://e/enc", encrypted },
        thumbnail: { url: "mxc://e/enc", encrypted },
      },
    ]);
  });

  it("asks for consent when told to, and waits for everyone to give it", async () => {
    vi.useFakeTimers();
    try {
      const { room, set, sendStateEvent } = setup();
      const members = state([
        member("@alice:e"),
        member("@bob:e"),
        member("@carol:e"),
        member("@bot:e"),
        member("@sip:e"),
      ]);
      const r = createRecording(
        testScope(),
        room,
        canRecord,
        slot,
        bot,
        none,
        rtcSession,
        members,
        constant(new Set(["@sip:e"])),
      );
      await r.toggle$.value!({ requireConsent: true });
      expect(sendStateEvent).toHaveBeenLastCalledWith(
        "!room",
        RecordingEventType,
        { recorder: bot, requires_consent: true },
        slot,
      );
      set(event("@alice:e", { recorder: bot, requires_consent: true }, "$req"));
      // We asked, so we've consented; the recorder and the bots aren't asked
      expect(r.recording$.value?.awaitingConsent).toEqual([
        "@bob:e",
        "@carol:e",
      ]);
      // Bob's other device consented to some other request, which doesn't
      // count; his phone consents to this one
      members.value = [
        member("@alice:e"),
        member("@bob:e", { $other: true }),
        member("@bob:e", { $req: true }),
        // Carol's client answered with something that isn't an answer
        member("@carol:e", { $req: "yes" }),
      ];
      expect(r.recording$.value?.consents).toEqual({ "@bob:e": true });
      expect(r.recording$.value?.awaitingConsent).toEqual(["@carol:e"]);
      // The recorder can't start until everyone has consented, so we don't
      // give up on it yet
      vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS);
      expect(sendStateEvent).not.toHaveBeenCalledWith(
        "!room",
        RecordingEventType,
        {},
        slot,
      );
      // Someone who leaves no longer needs to consent
      members.value = [member("@alice:e"), member("@bob:e", { $req: true })];
      expect(r.recording$.value?.awaitingConsent).toEqual([]);
      vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS);
      expect(r.error$.value).toBeInstanceOf(RecorderError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up when somebody declines", () => {
    const { room, set, sendStateEvent } = setup();
    const members = state([member("@alice:e"), member("@carol:e")]);
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      rtcSession,
      members,
      noBots,
    );
    set(event("@alice:e", { recorder: bot, requires_consent: true }, "$req"));
    members.value = [member("@alice:e"), member("@carol:e", { $req: false })];
    expect(r.error$.value).toBeInstanceOf(ConsentDeclinedError);
    expect((r.error$.value as ConsentDeclinedError).userId).toBe("@carol:e");
    expect(sendStateEvent).toHaveBeenCalledWith(
      "!room",
      RecordingEventType,
      {},
      slot,
    );
    // Once is enough
    members.value = [member("@carol:e", { $req: false })];
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it("consents through our membership", async () => {
    const { room, set } = setup();
    const updateApplicationData = vi.fn().mockResolvedValue(undefined);
    const r = createRecording(
      testScope(),
      room,
      canRecord,
      slot,
      bot,
      none,
      { updateApplicationData },
      people,
      noBots,
    );
    set(event("@bob:e", { recorder: bot, requires_consent: true }, "$req"));
    expect(r.recording$.value?.awaitingConsent).toEqual([
      "@alice:e",
      "@carol:e",
    ]);
    await r.consent(true);
    expect(updateApplicationData).toHaveBeenCalledWith({
      [RecordingConsentKey]: { $req: true },
    });
    // Counted before our membership comes back with it
    expect(r.recording$.value?.awaitingConsent).toEqual(["@carol:e"]);
  });
});

describe("consentOnJoin", () => {
  const withRequest = (
    content: RecordingEventContent,
    sender = "@bob:e",
  ): Room =>
    ({
      client: { getUserId: () => "@alice:e" },
      currentState: {
        getStateEvents: (type: string, key: string) =>
          type === RecordingEventType && key === slot
            ? event(sender, content, "$req")
            : null,
      },
    }) as unknown as Room;

  it("consents to a recording that needs it, if the lobby warned us", () => {
    const room = withRequest({ recorder: bot, requires_consent: true });
    expect(consentOnJoin(room, slot, true)).toEqual({
      [RecordingConsentKey]: { $req: true },
    });
    expect(consentOnJoin(room, slot, false)).toBeUndefined();
  });

  it("has nothing to say otherwise", () => {
    expect(
      consentOnJoin(withRequest({ recorder: bot }), slot, true),
    ).toBeUndefined();
    expect(consentOnJoin(withRequest({}), slot, true)).toBeUndefined();
    // Our own request needs no consent from us
    expect(
      consentOnJoin(
        withRequest({ recorder: bot, requires_consent: true }, "@alice:e"),
        slot,
        true,
      ),
    ).toBeUndefined();
  });
});
