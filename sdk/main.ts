/*
Copyright 2025-2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/**
 * EXPERIMENTAL
 *
 * This file is the entrypoint for the sdk build of element call: `pnpm build:sdk`
 * use in widgets.
 * It exposes the `createMatrixRTCSdk` which creates the `MatrixRTCSdk` interface (see below) that
 * can be used to join a rtc session and exchange realtime data.
 * It takes care of all the tricky bits:
 *  - sending delayed events
 *  - finding the right sfu
 *  - handling the media stream
 *  - sending join/leave state or sticky events
 *  - setting up encryption and scharing keys
 */

import {
  type CallMembership,
  MatrixRTCSessionEvent,
  MatrixRTCSessionManager,
} from "matrix-js-sdk/lib/matrixrtc";
import {
  type Room as LivekitRoom,
  type TextStreamReader,
  type LocalParticipant,
  type RemoteParticipant,
} from "livekit-client";

// TODO how can this get fixed? to just be part of `livekit-client`
// Can this be done in the tsconfig.json
import { type TextStreamInfo } from "../node_modules/livekit-client/dist/src/room/types";
import { type Behavior, computed, constant } from "../src/state/Behavior";
import { createCallViewModel$ } from "../src/state/CallViewModel/CallViewModel";
import { Scope } from "../src/state/Scope";
import { getUrlParams } from "../src/UrlParams";
import { MuteStates } from "../src/state/MuteStates";
import { MediaDevices } from "../src/state/MediaDevices";
import { E2eeType } from "../src/e2ee/e2eeType";
import { TEXT_LK_TOPIC, tryMakeSticky } from "./helper";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";
import {
  ElementWidgetActions,
  widget as _widget,
  initializeWidget,
} from "../src/widget";
import { type Connection } from "../src/state/CallViewModel/remoteMembers/Connection";

interface MatrixRTCSdk {
  /**
   * observe connected$ to track the state.
   * @returns
   */
  join: () => void;
  /** @throws on leave errors */
  leave: () => void;
  /**
   * Ends the rtc sdk. This will unsubscribe any event listeners. And end the associated scope.
   * No updates can be received from the rtc sdk. The sdk cannot be restarted after.
   * A new sdk needs to be created via createMatrixRTCSdk.
   */
  stop: () => void;
  /**
   * Registers a listener for data received from other members. Returns a
   * function that removes the listener again.
   */
  onData: (
    listener: (data: { rtcBackendIdentity: string; data: string }) => void,
  ) => () => void;
  /**
   * flattened list of remote members
   */
  remoteMembers$: Behavior<
    {
      connection: Connection | null;
      membership: CallMembership;
      participant: LocalParticipant | RemoteParticipant | null;
    }[]
  >;
  /**
   * flattened local member
   */
  localMember$: Behavior<{
    connection: Connection | null;
    membership: CallMembership;
    participant: LocalParticipant | null;
  } | null>;
  /** Use the LocalMemberConnectionState returned from `join` for a more detailed connection state  */
  connected$: Behavior<boolean>;
  sendData?: (data: unknown) => Promise<void>;
  sendRoomMessage?: (message: string) => Promise<void>;
}

export async function createMatrixRTCSdk(
  application: string = "m.call",
  id: string = "",
  sticky: boolean = false,
): Promise<MatrixRTCSdk> {
  const logger = rootLogger.getChild("[MatrixRTCSdk]");
  const scope = new Scope();

  // widget client
  initializeWidget(application, true);
  const widget = _widget;
  if (!widget) throw Error("No widget. This webapp can only start as a widget");
  const client = await widget.client;
  logger.info("client created");

  // url params
  const { roomId } = getUrlParams();
  if (roomId === null) throw Error("could not get roomId from url params");
  const room = client.getRoom(roomId);
  if (room === null) throw Error("could not get room from client");

  // rtc session
  const slot = { application, id };
  const rtcSessionManager = new MatrixRTCSessionManager(logger, client, slot);
  rtcSessionManager.start();
  const rtcSession = rtcSessionManager.getRoomSession(room);

  // media devices
  const mediaDevices = new MediaDevices(scope);
  const muteStates = new MuteStates(scope, mediaDevices, {
    audioEnabled: false,
    videoEnabled: false,
  });

  // call view model
  const callViewModel = createCallViewModel$(
    scope,
    rtcSession,
    room,
    mediaDevices,
    muteStates,
    { encryptionSystem: { kind: E2eeType.PER_PARTICIPANT } },
    constant({}),
    constant({}),
    constant({ supported: false, processor: undefined }),
  );
  logger.info("CallViewModelCreated");

  // create data listener
  const dataListeners = new Set<
    (data: { rtcBackendIdentity: string; data: string }) => void
  >();

  const lkTextStreamHandlerFunction = async (
    reader: TextStreamReader,
    participantInfo: { identity: string },
    livekitRoom: LivekitRoom,
  ): Promise<void> => {
    const info = reader.info;
    logger.info(
      `Received text stream from ${participantInfo.identity}\n` +
        `  Topic: ${info.topic}\n` +
        `  Timestamp: ${info.timestamp}\n` +
        `  ID: ${info.id}\n` +
        `  Size: ${info.size}`, // Optional, only available if the stream was sent with `sendText`
    );

    const participants = callViewModel.livekitRoomItems$.value.find(
      (i) => i.livekitRoom === livekitRoom,
    )?.participants;
    if (participants && participants.includes(participantInfo.identity)) {
      const text = await reader.readAll();
      logger.info(`Received text: ${text}`);
      const data = { rtcBackendIdentity: participantInfo.identity, data: text };
      for (const listener of dataListeners) listener(data);
    } else {
      logger.warn(
        "Received text from unknown participant",
        participantInfo.identity,
      );
    }
  };

  // Listen for text streams on every LiveKit room we're connected to
  let prevRooms: LivekitRoom[] = [];
  scope.effect(() => {
    const items = callViewModel.livekitRoomItems$.value;
    logger.info(`LiveKit room items updated: ${items.length}`, items);
    const currentRooms = items.map((i) => i.livekitRoom);
    for (const r of currentRooms.filter((r) => !prevRooms.includes(r))) {
      logger.info(`Registering text stream handler for room `);
      r.registerTextStreamHandler(
        TEXT_LK_TOPIC,
        (reader, participantInfo) =>
          void lkTextStreamHandlerFunction(reader, participantInfo, r),
      );
    }
    for (const r of prevRooms.filter((r) => !currentRooms.includes(r))) {
      logger.info(`Unregistering text stream handler for room `);
      r.unregisterTextStreamHandler(TEXT_LK_TOPIC);
    }
    prevRooms = currentRooms;
  });
  scope.onEnd(() => {
    for (const item of callViewModel.livekitRoomItems$.value) {
      logger.info("unregistering room item from room", item.url);
      item.livekitRoom.unregisterTextStreamHandler(TEXT_LK_TOPIC);
    }
  });

  // create sendData function
  const sendFn: Behavior<(data: string) => Promise<TextStreamInfo>> = computed(
    () => {
      const member = callViewModel.localMatrixLivekitMember$.value;
      if (!member)
        return (data: string): never => {
          throw Error("local membership not yet ready.");
        };
      const participant = member.participant.value$.value;
      if (participant === null)
        return (data: string): never => {
          throw Error("local participant not yet ready to send data.");
        };
      return async (data: string): Promise<TextStreamInfo> =>
        participant.sendText(data, { topic: TEXT_LK_TOPIC });
    },
  );

  const sendData = async (data: unknown): Promise<void> => {
    const dataString = JSON.stringify(data);
    logger.info("try sending: ", dataString);
    try {
      await Promise.resolve();
      const info = await sendFn.value(dataString);
      logger.info(`Sent text with stream ID: ${info.id}`);
    } catch (e) {
      logger.error("failed sending: ", dataString, e);
    }
  };

  const sendRoomMessage = async (message: string): Promise<void> => {
    const messageString = JSON.stringify(message);
    logger.info("try sending to room: ", messageString);
    try {
      await client.sendTextMessage(room.roomId, message);
    } catch (e) {
      logger.error("failed sending to room: ", messageString, e);
    }
  };

  // after hangup gets called
  scope.effect(() => {
    if (callViewModel.leaveReason$.value === null) return;
    const scheduleWidgetCloseOnLeave = async (): Promise<void> => {
      const leaveResolver = Promise.withResolvers<void>();
      logger.info("waiting for RTC leave");
      rtcSession.on(MatrixRTCSessionEvent.JoinStateChanged, (isJoined) => {
        logger.info("received RTC join update: ", isJoined);
        if (!isJoined) leaveResolver.resolve();
      });
      await leaveResolver.promise;
      logger.info("send Unstick");
      await widget.api
        .setAlwaysOnScreen(false)
        .catch((e) =>
          logger.error(
            "Failed to set call widget `alwaysOnScreen` to false",
            e,
          ),
        );
      logger.info("send Close");
      await widget.api.transport
        .send(ElementWidgetActions.Close, {})
        .catch((e) => logger.error("Failed to send close action", e));
    };

    // schedule close first and then leave (scope.end)
    void scheduleWidgetCloseOnLeave();
  });

  logger.info("createMatrixRTCSdk done");

  return {
    join: (): void => {
      // first lets try making the widget sticky
      if (sticky) tryMakeSticky(widget);
      callViewModel.join();
    },
    leave: (): void => {
      callViewModel.leave();
    },
    stop: (): void => {
      scope.end();
    },
    onData: (listener) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    localMember$: computed(() => {
      const member = callViewModel.localMatrixLivekitMember$.value;
      return member === null
        ? null
        : {
            connection: member.connection$.value,
            membership: member.membership$.value,
            participant: member.participant.value$.value,
          };
    }),
    connected$: callViewModel.connected$,
    remoteMembers$: computed(() =>
      callViewModel.remoteMatrixLivekitMembers$.value.map((member) => ({
        connection: member.connection$.value,
        membership: member.membership$.value,
        participant: member.participant.value$.value,
      })),
    ),
    sendData,
    sendRoomMessage,
  };
}
