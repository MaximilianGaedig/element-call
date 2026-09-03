/*
Copyright 2025 Element Creations Ltd.
Copyright 2023, 2024, 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type BaseKeyProvider,
  type ConnectionState,
  ExternalE2EEKeyProvider,
  type Room as LivekitRoom,
  type RoomOptions,
} from "livekit-client";
import { type Room as MatrixRoom } from "matrix-js-sdk";
import {
  catchError,
  combineLatest,
  filter,
  fromEvent,
  map,
  merge,
  NEVER,
  type Observable,
  of,
  pairwise,
  race,
  scan,
  startWith,
  Subject,
  switchMap,
  switchScan,
  take,
  tap,
  throttleTime,
  timer,
  takeUntil,
} from "rxjs";
import { type Logger, logger as rootLogger } from "matrix-js-sdk/lib/logger";
import {
  MembershipManagerEvent,
  type LivekitTransportConfig,
  type MatrixRTCSession,
} from "matrix-js-sdk/lib/matrixrtc";
import { type IWidgetApiRequest } from "matrix-widget-api";
import { type CallMembershipIdentityParts } from "matrix-js-sdk/lib/matrixrtc/EncryptionManager";
import { v4 as uuidv4 } from "uuid";
import { type IMembershipManager } from "matrix-js-sdk/lib/matrixrtc/IMembershipManager";

import {
  filterBehavior,
  generateItem,
  generateItems,
  pauseWhen,
} from "../../utils/observable";
import {
  duplicateTiles,
  playReactionsSound,
  showReactions,
} from "../../settings/settings";
import { Config } from "../../config/Config";
import { MatrixRTCMode } from "../../config/ConfigOptions";
import { isFirefox, platform } from "../../Platform";
import { setPipEnabled$ } from "../../controls";
import { TileStore } from "../TileStore";
import { gridLikeLayout } from "../GridLikeLayout";
import { spotlightExpandedLayout } from "../SpotlightExpandedLayout";
import { oneOnOneDesktopLayout } from "../OneOnOneDesktopLayout";
import { oneOnOneMobileLayout } from "../OneOnOneMobileLayout";
import { pipLayout } from "../PipLayout";
import { type EncryptionSystem } from "../../e2ee/sharedKeyManagement";
import {
  type RaisedHandInfo,
  type ReactionInfo,
  type ReactionOption,
} from "../../reactions";
import { shallowEquals as shallowArrayEquals } from "../../utils/array";
import { type MediaDevices } from "../MediaDevices";
import { type Behavior, computed, constant, state } from "../Behavior";
import { E2eeType } from "../../e2ee/e2eeType";
import { MatrixKeyProvider } from "../../e2ee/matrixKeyProvider";
import { type MuteStates } from "../MuteStates";
import { getUrlParams, HeaderStyle } from "../../UrlParams";
import { type ProcessorState } from "../../livekit/TrackProcessorContext";
import { ElementWidgetActions, widget } from "../../widget";
import {
  layoutShallowEquals,
  type Alignment,
  type GridLayoutMedia,
  type Layout,
  type LayoutMedia,
  type OneOnOneDesktopLayoutMedia,
  type OneOnOneMobileLayoutMedia,
  type SpotlightExpandedLayoutMedia,
  type SpotlightLandscapeLayoutMedia,
  type SpotlightPortraitLayoutMedia,
} from "../layout-types.ts";
import { ElementCallError, UnknownCallError } from "../../utils/errors.ts";
import { type Epoch, type ObservableScope } from "../ObservableScope.ts";
import { createHomeserverConnected$ } from "./localMember/HomeserverConnected.ts";
import {
  createLocalMembership$,
  enterRTCSession,
  TransportState,
} from "./localMember/LocalMember.ts";
import {
  createLocalTransport$,
  JwtEndpointVersion,
  type LocalTransport,
} from "./localMember/LocalTransport.ts";
import {
  createKeyRotationSuppressed$,
  createMemberships$,
  membershipsAndTransports$,
} from "../SessionBehaviors.ts";
import {
  type ConnectionFactory,
  ECConnectionFactory,
} from "./remoteMembers/ConnectionFactory.ts";
import {
  type ConnectionManagerData,
  createConnectionManager$,
} from "./remoteMembers/ConnectionManager.ts";
import {
  createRemoteMatrixLivekitMembers$,
  type LocalMatrixLivekitMember,
  type RemoteMatrixLivekitMember,
} from "./remoteMembers/MatrixLivekitMembers.ts";
import {
  type AutoLeaveReason,
  createCallNotificationLifecycle$,
  createReceivedDecline$,
  createSentCallNotification$,
} from "./CallNotificationLifecycle.ts";
import {
  createMatrixMemberMetadata$,
  createRoomMembers$,
} from "./remoteMembers/MatrixMemberMetadata.ts";
import { Publisher } from "./localMember/Publisher.ts";
import { type Connection } from "./remoteMembers/Connection.ts";
import {
  type LayoutSwitchViewModel,
  createLayoutSwitchViewModel,
} from "../LayoutSwitchViewModel.ts";
import {
  createWrappedUserMedia,
  type WrappedUserMediaViewModel,
} from "../media/WrappedUserMediaViewModel.ts";
import { type ScreenShareViewModel } from "../media/ScreenShareViewModel.ts";
import { type UserMediaViewModel } from "../media/UserMediaViewModel.ts";
import { type MediaViewModel } from "../media/MediaViewModel.ts";
import { type LocalUserMediaViewModel } from "../media/LocalUserMediaViewModel.ts";
import { type RemoteUserMediaViewModel } from "../media/RemoteUserMediaViewModel.ts";
import {
  createRingingMedia,
  type RingingMediaViewModel,
} from "../media/RingingMediaViewModel.ts";
import { type GridTileViewModel } from "../TileViewModel.ts";

//TODO
// Larger rename
// member,membership -> rtcMember
// participant -> livekitParticipant
// matrixLivekitItem -> callMember
// js-sdk
// callMembership -> rtcMembership
export interface CallViewModelOptions {
  encryptionSystem: EncryptionSystem;
  autoLeaveWhenOthersLeft?: boolean;
  /**
   * If the call is started in a way where we want it to behave like a telephone usecase
   * If we sent a notification event, we want the ui to show a ringing state
   */
  waitForCallPickup?: boolean;
  /** Optional factory to create LiveKit rooms, mainly for testing purposes. */
  livekitRoomFactory?: (options?: RoomOptions) => LivekitRoom;
  /** Optional behavior overriding the local connection state, mainly for testing purposes. */
  connectionState$?: Behavior<ConnectionState>;
  /** Optional behavior overriding the computed window size, mainly for testing purposes. */
  windowSize$?: Behavior<{ width: number; height: number }>;
  /** Optional value overriding the local transport, for testing purposes. */
  localTransport?: LocalTransport;
  /** Optional value overriding the connection factory, for testing purposes. */
  connectionFactory?: ConnectionFactory;
  /** The version & compatibility mode of MatrixRTC that we should use. */
  matrixRTCMode$?: Behavior<MatrixRTCMode>;
  /** Optional behavior overriding for the screensharing, for testing */
  toggleScreensharing?: () => void;
}

// Do not play any sounds if the participant count has exceeded this
// number.
export const MAX_PARTICIPANT_COUNT_FOR_SOUND = 8;
export const THROTTLE_SOUND_EFFECT_MS = 500;

// This is the number of participants that we think constitutes a "small" call
// on mobile. No spotlight tile should be shown below this threshold.
const smallMobileCallThreshold = 3;

// How long the footer should be shown for when hovering over or interacting
// with the interface
const showFooterMs = 4000;

export type WindowMode = "normal" | "narrow" | "flat" | "pip";

interface LayoutInternals {
  layout: Layout;
  overflowing: boolean;
  tiles: TileStore;
}

export type LivekitRoomItem = {
  livekitRoom: LivekitRoom;
  participants: string[];
  url: string;
};

/**
 * The return of createCallViewModel$
 * this interface represents the root source of data for the call view.
 * They are a list of observables and objects containing observables to allow for a very granular update mechanism.
 *
 * This allows to have one huge call view model that represents the entire view without a unnecessary amount of updates.
 *
 * (Mocking this interface should allow building a full view in all states.)
 */
export interface CallViewModel {
  // lifecycle
  autoLeave$: Observable<AutoLeaveReason>;
  /**
   * View model for info relating to ringing, timing out, calling back, etc.
   */
  ringingVm$: Behavior<RingingMediaViewModel | null>;
  /**
   * Which visual element the ringing status should be shown in.
   */
  ringingStatusLocation: "app_bar" | "tile";
  /** Observable that emits when the user should leave the call (hangup pressed, widget action, error).
   * THIS DOES NOT LEAVE THE CALL YET. The only way to leave the call (send the hangup event) is
   *  - by ending the scope
   *  - or calling requestDisconnect
   *
   * TODO: it seems more reasonable to add a leave() method (that calls requestDisconnect) that will then update leave$ and remove the hangup pattern
   */
  leave$: Observable<"user" | AutoLeaveReason>;
  /** Call to initiate hangup. Use in conbination with reconnection state track the async hangup process. */
  hangup: () => void;

  // joining
  join: () => void;

  /**
   * calls requestDisconnect. The async leave state can than be observed via connected$
   */
  leave: () => void;
  // screen sharing
  /**
   * Callback to toggle screen sharing. If null, screen sharing is not possible.
   */
  toggleScreenSharing: (() => void) | null;
  /**
   * Whether we are sharing our screen.
   */
  sharingScreen$: Behavior<boolean>;

  // UI interactions
  /**
   * Callback for when the user taps the call view.
   */
  tapScreen: () => void;
  /**
   * Callback for when the user taps the call's controls.
   */
  tapControls: () => void;
  /**
   * Callback for when the user hovers over the call view.
   */
  hoverScreen: () => void;
  /**
   * Callback for when the user stops hovering over the call view.
   */
  unhoverScreen: () => void;

  // errors
  /**
   * If there is a configuration error with the call (e.g. misconfigured E2EE).
   * This is a fatal error that prevents the call from being created/joined.
   * Should render a blocking error screen.
   */
  fatalError$: Behavior<ElementCallError | null>;

  // participants and counts
  /**
   * The number of participants currently in the call.
   *
   *  - Each participant has a corresponding MatrixRTC membership state event
   *  - There can be multiple participants for one Matrix user if they join from
   *    multiple devices.
   */
  participantCount$: Behavior<number>;
  /**
   * Whether the call has grown large enough that MatrixRTC has stopped rotating the media
   * encryption key. While this is true the key in use is still shared with new joiners, but no new
   * key is generated when someone joins or leaves.
   */
  keyRotationSuppressed$: Behavior<boolean>;
  allConnections$: Behavior<ConnectionManagerData>;
  /** Participants sorted by livekit room so they can be used in the audio rendering */
  livekitRoomItems$: Behavior<LivekitRoomItem[]>;
  /** use the layout instead, this is just for the sdk export. */
  remoteMatrixLivekitMembers$: Behavior<RemoteMatrixLivekitMember[]>;
  localMatrixLivekitMember$: Behavior<LocalMatrixLivekitMember | null>;
  /** List of participants raising their hand */
  handsRaised$: Behavior<Record<string, RaisedHandInfo>>;
  /** List of reactions. Keys are: membership.membershipId (currently predefined as: `${membershipEvent.userId}:${membershipEvent.deviceId}`)*/
  reactions$: Behavior<Record<string, ReactionOption>>;

  // sounds and events
  joinSoundEffect$: Observable<void>;
  leaveSoundEffect$: Observable<void>;
  /**
   * Emits an event every time a new hand is raised in
   * the call.
   */
  newHandRaised$: Observable<{ value: number; playSounds: boolean }>;
  /**
   * Emits an event every time a new screenshare is started in
   * the call.
   */
  newScreenShare$: Observable<{ value: number; playSounds: boolean }>;
  /**
   * Emits an array of reactions that should be played.
   */
  audibleReactions$: Observable<string[]>;
  /**
   * Emits an array of reactions that should be visible on the screen.
   */
  // DISCUSSION move this into a reaction file
  visibleReactions$: Behavior<
    { sender: string; emoji: string; startX: number }[]
  >;

  /**
   * The layout of tiles in the call interface.
   */
  layout$: Behavior<Layout>;
  /**
   * The current generation of the tile store, exposed for debugging purposes.
   */
  tileStoreGeneration$: Behavior<number>;
  showSpotlightIndicators$: Behavior<boolean>;
  showSpeakingIndicators$: Behavior<boolean>;
  showNameTags$: Behavior<boolean>;
  spotlightExpanded$: Behavior<boolean>;
  toggleSpotlightExpanded$: Behavior<(() => void) | null>;
  layoutSwitchVm$: Behavior<LayoutSwitchViewModel | null>;

  // header/footer visibility
  showHeader$: Behavior<boolean>;
  showFooter$: Behavior<boolean>;
  /**
   * Whether the call layout should be displayed edge-to-edge, with the footer
   * and header as overlays.
   */
  edgeToEdge$: Behavior<boolean>;
  /**
   * Whether the call layout is overflowing the interface (causing it to scroll).
   */
  overflowing$: Behavior<boolean>;

  /**
   * Whether modals such as settings and reactions should be accessible at all.
   */
  showModals$: Behavior<boolean>;

  settingsOpen$: Behavior<boolean>;
  setSettingsOpen$: Behavior<(open: boolean) => void>;

  // audio routing
  /**
   * Whether audio is currently being output through the earpiece.
   */
  earpieceMode$: Behavior<boolean>;
  /**
   * Callback to toggle between the earpiece and the loudspeaker.
   *
   * This will be `null` in case the target does not exist in the list
   * of available audio outputs.
   */
  audioOutputSwitcher$: Behavior<{
    targetOutput: "earpiece" | "speaker";
    switch: () => void;
  } | null>;

  /**
   * Whether the app is currently reconnecting to the LiveKit server and/or setting the matrix rtc room state.
   */
  reconnecting$: Behavior<boolean>;

  /**
   * Shortcut for not requireing to parse and combine connectionState.matrix and connectionState.livekit
   */
  connected$: Behavior<boolean>;
}

/**
 * A view model providing all the application logic needed to show the in-call
 * UI (may eventually be expanded to cover the lobby and feedback screens in the
 * future).
 */
// Throughout this class and related code we must distinguish between MatrixRTC
// state and LiveKit state. We use the common terminology of room "members", RTC
// "memberships", and LiveKit "participants".
export function createCallViewModel$(
  scope: ObservableScope,
  // A call is permanently tied to a single Matrix room
  matrixRTCSession: MatrixRTCSession,
  matrixRoom: MatrixRoom,
  mediaDevices: MediaDevices,
  muteStates: MuteStates,
  options: CallViewModelOptions,
  handsRaisedSubject$: Observable<Record<string, RaisedHandInfo>>,
  reactionsSubject$: Observable<Record<string, ReactionInfo>>,
  trackProcessorState$: Behavior<ProcessorState>,
): CallViewModel {
  const logger = rootLogger.getChild("[CallViewModel]");
  const client = matrixRoom.client;
  const userId = client.getUserId();
  const deviceId = client.getDeviceId();
  if (!(userId && deviceId))
    throw new UnknownCallError(new Error("userId and deviceId are required"));

  const livekitKeyProvider = getE2eeKeyProvider(
    options.encryptionSystem,
    matrixRTCSession,
    logger,
  );
  // matrix_rtc_mode in config.json overrides the user's Developer Settings choice.
  // It is validated at config load (src/config/Config.ts) so the cast is safe.
  const configMatrixRTCMode = Config.get().matrix_rtc_mode as
    | MatrixRTCMode
    | undefined;
  const matrixRTCMode$ =
    configMatrixRTCMode !== undefined
      ? constant(configMatrixRTCMode)
      : (options.matrixRTCMode$ ?? constant(MatrixRTCMode.Compatibility));

  // Each hbar seperates a block of input variables required for the CallViewModel to function.
  // The outputs of this block is written under the hbar.
  //
  // For mocking purposes it is recommended to only mock the functions creating those outputs.
  // All other fields are just temp computations for the mentioned output.
  // The class does not need anything except the values underneath the bar.
  // The creations of the values under the bar are all tested independently and testing the callViewModel Should
  // not test their creation. Call view model only needs:
  //  - memberships$ via createMemberships$
  //  - localMembership via createLocalMembership$
  //  - callLifecycle via createCallNotificationLifecycle$
  //  - matrixMemberMetadataStore via createMatrixMemberMetadata$

  // ------------------------------------------------------------------------
  // memberships$
  const memberships$ = createMemberships$(scope, matrixRTCSession);

  // ------------------------------------------------------------------------
  // matrixLivekitMembers$ AND localMembership

  const membershipsAndTransports = membershipsAndTransports$(
    scope,
    memberships$,
  );

  const ownMembershipIdentity: CallMembershipIdentityParts = {
    userId,
    deviceId,
    // This will only be consumed by the sticky membership manager. So it has no impact on legacy calls.
    memberId: uuidv4(),
  };

  const localTransport$ = scope.behavior(
    matrixRTCMode$.pipe(
      generateItem(
        "CallViewModel localTransport$",
        // Re-create LocalTransport whenever the mode changes
        (mode) => ({ keys: [mode], data: undefined }),
        (scope, _data$, mode) =>
          options.localTransport ??
          createLocalTransport$({
            scope: scope,
            memberships$: memberships$,
            ownMembershipIdentity,
            client,
            delayId$: scope.behavior(
              (
                fromEvent(
                  matrixRTCSession,
                  MembershipManagerEvent.DelayIdChanged,
                  // The type of reemitted event includes the original emitted as the second arg.
                ) as Observable<[string | undefined, IMembershipManager]>
              ).pipe(map(([delayId]) => delayId ?? null)),
              matrixRTCSession.delayId ?? null,
            ),
            roomId: matrixRoom.roomId,
            forceJwtEndpoint:
              mode === MatrixRTCMode.Matrix_2_0
                ? JwtEndpointVersion.Matrix_2_0
                : JwtEndpointVersion.Legacy,
          }),
      ),
    ),
  );

  const connectionFactory =
    options.connectionFactory ??
    new ECConnectionFactory(
      client,
      matrixRoom.roomId,
      mediaDevices,
      trackProcessorState$,
      livekitKeyProvider,
      getUrlParams().controlledAudioDevices,
      options.livekitRoomFactory,
    );

  const connectionManager = createConnectionManager$({
    scope: scope,
    connectionFactory: connectionFactory,
    localTransport$: scope.behavior(
      localTransport$.pipe(
        switchMap((t) => t.active$),
        catchError((e: unknown) => {
          logger.info(
            "could not pass local transport to createConnectionManager$. localTransport$ threw an error",
            e,
          );
          return of(null);
        }),
      ),
    ),
    remoteTransports$: membershipsAndTransports.transports$,
    logger: logger,
    ownMembershipIdentity,
  });

  const remoteMatrixLivekitMembers$: Behavior<
    Epoch<RemoteMatrixLivekitMember[]>
  > = createRemoteMatrixLivekitMembers$({
    scope: scope,
    membershipsWithTransport$:
      membershipsAndTransports.membershipsWithTransport$,
    connectionManager: connectionManager,
    localUser: { userId, deviceId },
  });

  const connectOptions$ = computed(() => ({
    encryptMedia: livekitKeyProvider !== undefined,
    // TODO. This might need to get called again on each change of matrixRTCMode...
    matrixRTCMode: matrixRTCMode$.value,
  }));

  const localMembership = createLocalMembership$({
    scope,
    homeserverConnected: createHomeserverConnected$(
      scope,
      client,
      matrixRTCSession,
    ),
    muteStates,
    joinMatrixRTC: (transport: LivekitTransportConfig) => {
      return enterRTCSession(
        matrixRTCSession,
        ownMembershipIdentity,
        transport,
        connectOptions$.value,
      );
    },
    createPublisherFactory: (connection: Connection) => {
      return new Publisher(
        connection,
        mediaDevices,
        muteStates,
        trackProcessorState$,
        logger.getChild(
          "[Publisher " + connection.transport.livekit_service_url + "]",
        ),
      );
    },
    connectionManager,
    matrixRTCSession,
    localTransport$,
    roomId: matrixRoom.roomId,
    logger: logger.getChild(`[${Date.now()}]`),
  });

  const localRtcMembership$ = computed(
    () =>
      memberships$.value.value.find(
        (membership) =>
          membership.userId === userId && membership.deviceId === deviceId,
      ) ?? null,
  );

  const localMatrixLivekitMember$: Behavior<LocalMatrixLivekitMember | null> =
    scope.behavior(
      localRtcMembership$.pipe(
        filterBehavior((membership) => membership !== null),
        map((membership$) => {
          if (membership$ === null) return null;
          return {
            membership$,
            participant: {
              type: "local" as const,
              value$: localMembership.participant$,
            },
            connection$: localMembership.connection$,
            userId,
          };
        }),
      ),
    );

  const matrixLivekitMembers$ = computed(() => {
    const local = localMatrixLivekitMember$.value;
    return [
      ...(local === null ? [] : [local]),
      ...remoteMatrixLivekitMembers$.value.value,
    ];
  });

  // ------------------------------------------------------------------------
  // matrixMemberMetadataStore

  const matrixRoomMembers$ = createRoomMembers$(scope, matrixRoom);
  const matrixMemberMetadataStore = createMatrixMemberMetadata$(
    scope,
    computed(() => memberships$.value.value),
    matrixRoomMembers$,
  );

  // ------------------------------------------------------------------------
  // callLifecycle

  // TODO if we are in "unknown" state we need a loading rendering (or empty screen)
  // Otherwise it looks like we already connected and only than the ringing starts which is weird.
  const { ringAttempts$, autoLeave$ } = createCallNotificationLifecycle$({
    scope,
    memberships$,
    matrixRoomMembers$,
    sentCallNotification$: createSentCallNotification$(scope, matrixRTCSession),
    receivedDecline$: createReceivedDecline$(matrixRoom),
    options,
    localUser: { userId, deviceId },
  });

  const allConnections$ = computed(
    () => connectionManager.connectionManagerData$.value.value,
  );
  /**
   * The remote participants to render audio for, grouped by LiveKit room.
   */
  const livekitRoomItems$ = computed<LivekitRoomItem[]>(() => {
    const items: LivekitRoomItem[] = [];
    for (const member of remoteMatrixLivekitMembers$.value.value) {
      const connection = member.connection$.value;
      const participant = member.participant.value$.value;
      // do not render audio for local participant
      if (!connection || !participant || participant.isLocal) continue;
      const url = connection.transport.livekit_service_url;
      const existing = items.find((item) => item.url === url);
      if (existing) existing.participants.push(participant.identity);
      else
        items.push({
          url,
          livekitRoom: connection.livekitRoom,
          participants: [participant.identity],
        });
    }
    return items;
  });

  const handsRaised$ = scope.behavior(
    handsRaisedSubject$.pipe(pauseWhen(localMembership.reconnecting$)),
  );

  const reactions$ = scope.behavior(
    reactionsSubject$.pipe(
      map((v) =>
        Object.fromEntries(
          Object.entries(v).map(([a, { reactionOption }]) => [
            a,
            reactionOption,
          ]),
        ),
      ),
      pauseWhen(localMembership.reconnecting$),
    ),
  );

  /**
   * List of user media (camera feeds) that we want tiles for.
   */
  const userMedia$ = scope.behavior<WrappedUserMediaViewModel[]>(
    combineLatest([matrixLivekitMembers$, duplicateTiles.value$]).pipe(
      // Generate a collection of user media from the list of expected (whether
      // present or missing) LiveKit participants.
      generateItems(
        "CallViewModel userMedia$",
        function* ([members, duplicateTiles]) {
          for (const {
            userId,
            participant,
            connection$,
            membership$,
          } of members) {
            const rtcId = membership$.value.rtcBackendIdentity;
            const mediaId = `${userId}:${membership$.value.deviceId}`;
            for (let dup = 0; dup < 1 + duplicateTiles; dup++) {
              yield {
                keys: [dup, mediaId, userId, participant, connection$, rtcId],
                data: undefined,
              };
            }
          }
        },
        (scope, _, dup, mediaId, userId, participant, connection$, rtcId) =>
          createWrappedUserMedia(scope, {
            id: `${mediaId}:${dup}`,
            userId,
            rtcBackendIdentity: rtcId,
            participant,
            encryptionSystem: options.encryptionSystem,
            livekitRoom$: computed(() => connection$.value?.livekitRoom),
            focusUrl$: computed(
              () => connection$.value?.transport.livekit_service_url,
            ),
            mediaDevices,
            pretendToBeDisconnected$: localMembership.reconnecting$,
            displayName$: (() => {
              const name$ =
                matrixMemberMetadataStore.createDisplayNameBehavior$(
                  scope,
                  userId,
                );
              return computed(() => name$.value ?? userId);
            })(),
            mxcAvatarUrl$: matrixMemberMetadataStore.createAvatarUrlBehavior$(
              scope,
              userId,
            ),
            handRaised$: computed(
              () => handsRaised$.value[mediaId]?.time ?? null,
            ),
            reaction$: computed(() => reactions$.value[mediaId] ?? undefined),
          }),
      ),
    ),
  );

  const ringingMedia$ = scope.behavior<RingingMediaViewModel | null>(
    ringAttempts$.pipe(
      switchMap(({ intent, recipient, outcome$ }) =>
        outcome$.pipe(
          startWith("ringing" as const),
          generateItems(
            "CallViewModel ringingMedia$",
            function* (pickupState) {
              if (pickupState !== "accept")
                yield { keys: [intent, recipient], data: pickupState };
            },
            (scope, pickupState$, intent, userId) =>
              createRingingMedia({
                id: `ringing:${userId}`,
                userId,
                displayName$: computed(
                  () =>
                    matrixRoomMembers$.value.get(userId)?.rawDisplayName ||
                    userId,
                ),
                mxcAvatarUrl$:
                  matrixMemberMetadataStore.createAvatarUrlBehavior$(
                    scope,
                    userId,
                  ),
                pickupState$,
                intent,
              }),
          ),
          map(([media]) => media ?? null),
        ),
      ),
      startWith(null),
    ),
  );

  /**
   * All screen share media that we want to display.
   */
  const screenShares$ = computed<ScreenShareViewModel[]>(() =>
    userMedia$.value.flatMap((m) => m.screenShares$.value),
  );

  const joinSoundEffect$ = userMedia$.pipe(
    pairwise(),
    filter(
      ([prev, current]) =>
        current.length <= MAX_PARTICIPANT_COUNT_FOR_SOUND &&
        current.length > prev.length,
    ),
    map(() => {}),
    throttleTime(THROTTLE_SOUND_EFFECT_MS),
  );

  /**
   * The number of participants currently in the call.
   *
   *  - Each participant has a corresponding MatrixRTC membership state event
   *  - There can be multiple participants for one Matrix user if they join from
   *    multiple devices.
   */
  const participantCount$ = computed(() => matrixLivekitMembers$.value.length);

  const keyRotationSuppressed$ = createKeyRotationSuppressed$(
    scope,
    matrixRTCSession,
  );

  const leaveSoundEffect$ = userMedia$.pipe(
    pairwise(),
    filter(
      ([prev, current]) =>
        current.length <= MAX_PARTICIPANT_COUNT_FOR_SOUND &&
        current.length < prev.length,
    ),
    map(() => {}),
    throttleTime(THROTTLE_SOUND_EFFECT_MS),
    // Avoid doubling up on any auto-leave sounds (e.g. the decline sound),
    // which are handled elsewhere
    takeUntil(autoLeave$),
  );

  const userHangup$ = new Subject<void>();

  const widgetHangup$ =
    widget === null
      ? NEVER
      : (
          fromEvent(
            widget.lazyActions,
            ElementWidgetActions.HangupCall,
          ) as Observable<CustomEvent<IWidgetApiRequest>>
        ).pipe(
          tap((ev) => {
            widget!.api.transport.reply(ev.detail, {});
          }),
        );

  const leave$: Observable<"user" | "timeout" | "decline" | "allOthersLeft"> =
    merge(
      autoLeave$,
      merge(userHangup$, widgetHangup$).pipe(map(() => "user" as const)),
    ).pipe(scope.share);

  let prevSpotlightSpeaker: WrappedUserMediaViewModel | undefined;
  const spotlightSpeaker$ = computed<WrappedUserMediaViewModel | undefined>(
    () => {
      const mediaItems = userMedia$.value;
      // Only remote users that are still in the call should be sticky
      const prev = prevSpotlightSpeaker;
      const stickyMedia =
        prev !== undefined && !prev.local && mediaItems.includes(prev)
          ? prev
          : undefined;
      // Decide who to spotlight:
      // If the previous speaker is still speaking, stick with them rather than
      // switching eagerly to someone else
      const speaker = stickyMedia?.speaking$.value
        ? stickyMedia
        : // Otherwise, select any remote user who is speaking
          (mediaItems.find((m) => !m.local && m.speaking$.value) ??
          // Otherwise, stick with the person who was last speaking
          stickyMedia ??
          // Otherwise, spotlight an arbitrary remote user
          mediaItems.find((m) => !m.local) ??
          // Otherwise, spotlight the local user
          mediaItems.find((m) => m.local));
      prevSpotlightSpeaker = speaker;
      return speaker;
    },
  );

  /**
   * The user media sorted into the order they should appear in the grid.
   */
  const grid$ = computed<UserMediaViewModel[]>(
    () =>
      userMedia$.value
        .map((m) => [m, m.bin$.value] as const)
        .sort(([, bin1], [, bin2]) => bin1 - bin2)
        .map(([m]) => m),
    shallowArrayEquals,
  );

  /**
   * Local user media suitable for displaying in a PiP (undefined if not found,
   * video is muted, or if user prefers to not see themselves).
   */
  const localUserMediaForPip$ = computed<LocalUserMediaViewModel | undefined>(
    () => {
      const localUserMedia = userMedia$.value.find(
        (m): m is WrappedUserMediaViewModel & LocalUserMediaViewModel =>
          m.type === "user" && m.local,
      );
      return localUserMedia?.videoEnabled$.value &&
        localUserMedia.alwaysShow$.value
        ? localUserMedia
        : undefined;
    },
  );

  /**
   * The media to show in the spotlight.
   */
  const spotlight$ = computed<MediaViewModel[]>(() => {
    const ringingMedia = ringingMedia$.value;
    if (ringingMedia !== null) return [ringingMedia];
    const screenShares = screenShares$.value;
    if (screenShares.length > 0) return screenShares;
    const speaker = spotlightSpeaker$.value;
    return speaker ? [speaker] : [];
  }, shallowArrayEquals);

  /**
   * The media to show in the picture-in-picture tile of the expanded spotlight
   * layout.
   */
  const spotlightPip$ = computed<UserMediaViewModel | undefined>(() => {
    if (ringingMedia$.value !== null) return localUserMediaForPip$.value;
    if (screenShares$.value.length > 0) return spotlightSpeaker$.value;
    // Hide PiP if redundant (i.e. if local user is already in spotlight)
    const pip = localUserMediaForPip$.value;
    return pip === spotlightSpeaker$.value ? undefined : pip;
  });

  const hasRemoteScreenShares$ = computed(() =>
    spotlight$.value.some((vm) => vm.type === "screen share" && !vm.local),
  );

  const pipEnabled$ = scope.behavior(setPipEnabled$, false);

  const windowSize$ =
    options.windowSize$ ??
    scope.behavior<{ width: number; height: number }>(
      fromEvent(window, "resize").pipe(
        startWith(null),
        map(() => ({ width: window.innerWidth, height: window.innerHeight })),
      ),
    );

  // A guess at what the window's mode should be based on its size and shape.
  const naturalWindowMode$ = computed<WindowMode>(() => {
    const { width, height } = windowSize$.value;
    if (height <= 400 && width <= 340) return "pip";
    // Our layouts for flat windows are better at adapting to a small width
    // than our layouts for narrow windows are at adapting to a small height,
    // so we give "flat" precedence here
    if (height <= 600) return "flat";
    if (width <= 600) return "narrow";
    return "normal";
  });

  /**
   * The general shape of the window.
   */
  const windowMode$ = computed<WindowMode>(() =>
    pipEnabled$.value ? "pip" : naturalWindowMode$.value,
  );

  const spotlightExpanded$ = state(false);
  const toggleSpotlightExpanded = (): void => {
    spotlightExpanded$.value = !spotlightExpanded$.value;
  };

  const layoutSwitchVm = createLayoutSwitchViewModel(
    scope,
    windowMode$,
    hasRemoteScreenShares$,
  );

  const oneOnOneLayoutMedia$ = computed<{
    local: LocalUserMediaViewModel;
    remote: UserMediaViewModel | RingingMediaViewModel;
  } | null>(() => {
    const userMedia = userMedia$.value;
    // One-on-one layout only supports 2 user media, no screen shares
    if (userMedia.length > 2 || screenShares$.value.length > 0) return null;
    const local = userMedia.find(
      (vm): vm is WrappedUserMediaViewModel & LocalUserMediaViewModel =>
        vm.type === "user" && vm.local,
    );
    if (local === undefined) return null;
    const remote = userMedia.find(
      (vm): vm is WrappedUserMediaViewModel & RemoteUserMediaViewModel =>
        vm.type === "user" && !vm.local,
    );
    if (remote !== undefined) return { local, remote };
    // If there's no other user media in the call (could still happen in this
    // branch due to the duplicate tiles option), we could possibly show ringing
    // media instead
    const ringingMedia = userMedia.length === 1 ? ringingMedia$.value : null;
    return ringingMedia === null ? null : { local, remote: ringingMedia };
  });

  /**
   * The media to be used to produce a layout.
   */
  const layoutMedia$ = computed<LayoutMedia>(() => {
    const gridLayout = (): GridLayoutMedia => {
      const spotlight = spotlight$.value;
      return {
        type: "grid",
        edgeToEdge: false,
        spotlight: spotlight.some((vm) => vm.type === "screen share")
          ? spotlight
          : undefined,
        grid: grid$.value,
      };
    };
    const spotlightLandscape = (
      edgeToEdge: boolean,
    ): SpotlightLandscapeLayoutMedia => ({
      type: "spotlight-landscape",
      edgeToEdge,
      spotlight: spotlight$.value,
      grid: grid$.value,
    });
    const spotlightPortrait = (): SpotlightPortraitLayoutMedia => ({
      type: "spotlight-portrait",
      edgeToEdge: false,
      spotlight: spotlight$.value,
      grid: grid$.value,
    });
    const spotlightExpanded = (
      edgeToEdge: boolean,
    ): SpotlightExpandedLayoutMedia => ({
      type: "spotlight-expanded",
      edgeToEdge,
      spotlight: spotlight$.value,
      pip: spotlightPip$.value,
    });
    const oneOnOneDesktop = (
      media: NonNullable<typeof oneOnOne>,
    ): OneOnOneDesktopLayoutMedia =>
      media.remote.type === "ringing"
        ? {
            type: "one-on-one-desktop",
            edgeToEdge: false,
            spotlight: media.local,
            pip: media.remote,
          }
        : {
            type: "one-on-one-desktop",
            edgeToEdge: false,
            spotlight: media.remote,
            pip: media.local,
          };
    const oneOnOneMobile = (
      media: NonNullable<typeof oneOnOne>,
    ): OneOnOneMobileLayoutMedia => ({
      type: "one-on-one-mobile",
      edgeToEdge: true,
      spotlight: media.remote,
      pip: media.local.videoEnabled$.value ? media.local : undefined,
    });

    const oneOnOne = oneOnOneLayoutMedia$.value;
    switch (windowMode$.value) {
      case "normal":
        if (layoutSwitchVm.layout$.value === "grid")
          return oneOnOne === null ? gridLayout() : oneOnOneDesktop(oneOnOne);
        return spotlightExpanded$.value
          ? spotlightExpanded(false)
          : spotlightLandscape(false);
      case "narrow":
        if (oneOnOne !== null) return oneOnOneMobile(oneOnOne);
        return grid$.value.length > smallMobileCallThreshold ||
          spotlight$.value.some((vm) => vm.type === "screen share")
          ? spotlightPortrait()
          : gridLayout();
      case "flat":
        if (oneOnOne !== null) return oneOnOneMobile(oneOnOne);
        // Yes, grid mode actually gets you a "spotlight" layout in this window
        // mode.
        return layoutSwitchVm.layout$.value === "grid"
          ? spotlightLandscape(true)
          : spotlightExpanded(true);
      case "pip":
        return {
          type: "pip",
          edgeToEdge: platform !== "desktop",
          spotlight: spotlight$.value,
        };
    }
  });

  // Tell the embedding app which way the picture-in-picture media is oriented
  let prevPipOrientation: "landscape" | "portrait" | undefined;
  scope.effect(() => {
    const pipMedia = spotlight$.value[0];
    if (pipMedia === undefined) return;
    const orientation =
      pipMedia.type === "user" ? pipMedia.videoOrientation$.value : "landscape";
    if (orientation === prevPipOrientation) return;
    prevPipOrientation = orientation;
    logger.info("controls api pip orientation updated:", orientation);
    window.controls.onPipMediaOrientationUpdate?.(orientation);
  });

  const showSpotlightIndicators$ = computed(
    () => layoutMedia$.value.type !== "grid",
  );

  const showSpeakingIndicators$ = computed<boolean>(() => {
    const l = layoutMedia$.value;
    switch (l.type) {
      case "spotlight-landscape":
      case "spotlight-portrait":
        // If the spotlight is showing the active speaker, we can do without
        // speaking indicators as they're a redundant visual cue. But if
        // screen sharing feeds are in the spotlight we still need them.
        return l.spotlight.some((m) => m.type === "screen share");
      // In expanded spotlight layout, the active speaker is always shown in
      // the picture-in-picture tile so there is no need for speaking
      // indicators. And in one-on-one layout there's no question as to who is
      // speaking.
      case "spotlight-expanded":
      case "one-on-one-desktop":
      case "one-on-one-mobile":
        return false;
      default:
        return true;
    }
  });

  const showNameTags$ = computed<boolean>(() => {
    const { type } = layoutMedia$.value;
    if (type !== "pip" && type !== "one-on-one-mobile") return true;
    // Hide name tags by default in these layouts. For safety we still need to
    // show them in case it wouldn't be clear who the spotlight media belongs
    // to.
    // TODO: Respect io.element.functional_members (while still being careful
    // to never show a functional member's media without a name tag!)
    // TODO: Only hide name tags in DMs, not group chats that just happen to
    // have only 2 users
    return matrixRoomMembers$.value.size > 2;
  });

  const toggleSpotlightExpanded$ = computed<(() => void) | null>(() => {
    if (windowMode$.value !== "normal") return null;
    const { type } = layoutMedia$.value;
    return type === "spotlight-landscape" || type === "spotlight-expanded"
      ? toggleSpotlightExpanded
      : null;
  });

  const edgeToEdge$ = computed(() => layoutMedia$.value.edgeToEdge);

  // Only show the layout switch in cases where it has an effect on the layout
  const showLayoutSwitch$ = computed<boolean>(() => {
    switch (windowMode$.value) {
      case "normal":
        return true;
      case "flat":
        return oneOnOneLayoutMedia$.value === null;
      default:
        return false;
    }
  });

  const screenTap$ = new Subject<void>();
  const controlsTap$ = new Subject<void>();
  const screenHover$ = new Subject<void>();
  const screenUnhover$ = new Subject<void>();

  const naturallyShowFooter$ = scope.behavior<boolean>(
    edgeToEdge$.pipe(
      switchMap((edgeToEdge) => {
        if (!edgeToEdge) return of(true);

        // Sadly Firefox has some layering glitches that prevent the footer
        // from appearing properly. They happen less often if we never hide
        // the footer.
        if (isFirefox()) return of(true);

        // Layout is edge-to-edge; show/hide the footer in response to interactions
        return windowMode$.pipe(
          switchMap((mode) => {
            if (mode === "pip" && platform !== "desktop") {
              // No controls are shown in mobile pip as interactions are disabled
              return of(false);
            }
            const showInitially = mode !== "flat";
            const timeout$ = mode === "flat" ? timer(showFooterMs) : NEVER;

            return merge(
              screenTap$.pipe(map(() => "tap screen" as const)),
              controlsTap$.pipe(map(() => "tap controls" as const)),
              screenHover$.pipe(map(() => "hover" as const)),
            ).pipe(
              switchScan((state, interaction) => {
                switch (interaction) {
                  case "tap screen":
                    return state
                      ? // Toggle visibility on tap
                        of(false)
                      : // Hide after a timeout
                        timeout$.pipe(
                          map(() => false),
                          startWith(true),
                        );
                  case "tap controls":
                    // The user is interacting with things, so reset the timeout
                    return timeout$.pipe(
                      map(() => false),
                      startWith(true),
                    );
                  case "hover":
                    // Show on hover and hide after a timeout
                    return race(timeout$, screenUnhover$.pipe(take(1))).pipe(
                      map(() => false),
                      startWith(true),
                    );
                }
              }, showInitially),
              startWith(showInitially),
            );
          }),
        );
      }),
    ),
  );

  const urlParams = getUrlParams();
  const showFooterUrlParams = !(
    urlParams.header === HeaderStyle.None && urlParams.showControls === false
  );
  const showFooter$ = computed(
    () => naturallyShowFooter$.value && showFooterUrlParams,
  );

  const showModals$ = computed(() => windowMode$.value !== "pip");

  const settingsOpen$ = state(false);
  const setSettingsOpen$ = constant((open: boolean) => {
    settingsOpen$.value = open;
  });

  const showHeader$ = computed<boolean>(() => {
    // In small windows the header would be too obstructive
    if (windowMode$.value === "pip") return false;
    // In edge-to-edge layouts, couple the visibility of the header to that of
    // the footer
    return edgeToEdge$.value ? showFooter$.value : true;
  });

  /**
   * The alignment of the floating spotlight tile, if present.
   */
  const spotlightAlignment$ = state<Alignment>({
    inline: "end",
    block: "end",
  });
  /**
   * The size of the small picture-in-picture tile, if present, when in portrait.
   */
  const portraitPipSize$ = computed(() => (showFooter$.value ? "lg" : "sm"));
  /**
   * The alignment of the small picture-in-picture tile, if present, when in portrait.
   */
  const portraitPipAlignment$ = state<Alignment>({
    inline: "end",
    block: "end",
  });
  /**
   * The alignment of the small picture-in-picture tile, if present, when in landscape.
   */
  const landscapePipAlignment$ = state<Alignment>({
    inline: "end",
    block: "start",
  });

  // There is a cyclical dependency here: the layout algorithms want to know
  // which tiles are on screen, but to know which tiles are on screen we have to
  // first render a layout. To deal with this we assume initially that all tiles
  // are visible, and loop the data back into the layouts through a State.
  const visibleTiles$ = state(Infinity);
  const setVisibleTiles = (value: number): void => {
    visibleTiles$.value = value;
  };

  // This is an effect rather than a computed because the TileStore mutates the
  // tile view models it reuses
  const layoutInternals$ = state<LayoutInternals | null>(null);
  scope.effect(() => {
    const media = layoutMedia$.value;
    const visibleTiles = visibleTiles$.value;
    const prevTiles = layoutInternals$.peek()?.tiles ?? TileStore.empty();
    let layout: Layout;
    let tiles: TileStore;
    let pip: GridTileViewModel | undefined;
    let overflowing = false;
    switch (media.type) {
      case "grid":
      case "spotlight-landscape":
      case "spotlight-portrait":
        [layout, tiles] = gridLikeLayout(
          media,
          spotlightAlignment$,
          visibleTiles,
          setVisibleTiles,
          prevTiles,
        );
        overflowing = tiles.gridTiles.length > visibleTiles;
        break;
      case "spotlight-expanded":
        [layout, tiles] = spotlightExpandedLayout(
          media,
          landscapePipAlignment$,
          prevTiles,
        );
        break;
      case "one-on-one-desktop":
        [layout, tiles] = oneOnOneDesktopLayout(
          media,
          landscapePipAlignment$,
          prevTiles,
        );
        pip = layout.pip;
        break;
      case "one-on-one-mobile":
        [layout, tiles] = oneOnOneMobileLayout(
          media,
          portraitPipSize$,
          portraitPipAlignment$,
          prevTiles,
        );
        pip = layout.pip;
        break;
      case "pip":
        [layout, tiles] = pipLayout(media, prevTiles);
        break;
    }

    for (const tile of tiles.gridTiles) tile.setShowOutline(tile === pip);

    layoutInternals$.value = { layout, overflowing, tiles };
  });

  /**
   * The layout of tiles in the call interface.
   */
  const layout$ = computed<Layout>(
    () => layoutInternals$.value!.layout,
    // Drop redundant layout updates before they would hit React.
    layoutShallowEquals,
  );

  const overflowing$ = computed(() => layoutInternals$.value!.overflowing);

  /**
   * The current generation of the tile store, exposed for debugging purposes.
   */
  const tileStoreGeneration$ = computed(
    () => layoutInternals$.value!.tiles.generation,
  );

  /**
   * Whether audio is currently being output through the earpiece.
   */
  const earpieceMode$ = scope.behavior<boolean>(
    combineLatest(
      [mediaDevices.audioOutput.available$, mediaDevices.audioOutput.selected$],
      (available, selected) =>
        selected !== undefined &&
        available.get(selected.id)?.type === "earpiece",
    ),
  );

  /**
   * Callback to toggle between the earpiece and the loudspeaker.
   *
   * This will be `null` in case the target does not exist in the list
   * of available audio outputs.
   */
  const audioOutputSwitcher$ = scope.behavior<{
    targetOutput: "earpiece" | "speaker";
    switch: () => void;
  } | null>(
    combineLatest(
      [mediaDevices.audioOutput.available$, mediaDevices.audioOutput.selected$],
      (available, selected) => {
        const selectionType = selected && available.get(selected.id)?.type;

        // If we are in any output mode other than speaker switch to speaker.
        const newSelectionType: "earpiece" | "speaker" =
          selectionType === "speaker" ? "earpiece" : "speaker";
        const newSelection = [...available].find(
          ([, d]) => d.type === newSelectionType,
        );
        if (newSelection === undefined) return null;

        const [id] = newSelection;
        return {
          targetOutput: newSelectionType,
          switch: (): void => mediaDevices.audioOutput.select(id),
        };
      },
    ),
  );

  /**
   * Emits an array of reactions that should be visible on the screen.
   */
  // DISCUSSION move this into a reaction file
  // const {visibleReactions$, audibleReactions$} = reactionsObservables$(showReactionSetting$, )
  const visibleReactions$ = scope.behavior(
    showReactions.value$.pipe(
      switchMap((show) => (show ? reactions$ : of({}))),
      scan<
        Record<string, ReactionOption>,
        { sender: string; emoji: string; startX: number }[]
      >((acc, latest) => {
        const newSet: { sender: string; emoji: string; startX: number }[] = [];
        for (const [sender, reaction] of Object.entries(latest)) {
          const startX =
            acc.find((v) => v.sender === sender && v.emoji)?.startX ??
            Math.ceil(Math.random() * 80) + 10;
          newSet.push({ sender, emoji: reaction.emoji, startX });
        }
        return newSet;
      }, []),
    ),
  );

  /**
   * Emits an array of reactions that should be played.
   */
  const audibleReactions$ = playReactionsSound.value$.pipe(
    switchMap((show) =>
      show ? reactions$ : of<Record<string, ReactionOption>>({}),
    ),
    map((reactions) => Object.values(reactions).map((v) => v.name)),
    scan<string[], { playing: string[]; newSounds: string[] }>(
      (acc, latest) => {
        return {
          playing: latest.filter(
            (v) => acc.playing.includes(v) || acc.newSounds.includes(v),
          ),
          newSounds: latest.filter(
            (v) => !acc.playing.includes(v) && !acc.newSounds.includes(v),
          ),
        };
      },
      { playing: [], newSounds: [] },
    ),
    map((v) => v.newSounds),
  );

  const newHandRaised$ = handsRaised$.pipe(
    map((v) => Object.keys(v).length),
    scan(
      (acc, newValue) => ({
        value: newValue,
        playSounds: newValue > acc.value,
      }),
      { value: 0, playSounds: false },
    ),
    filter((v) => v.playSounds),
  );

  const newScreenShare$ = screenShares$.pipe(
    map((v) => v.length),
    scan(
      (acc, newValue) => ({
        value: newValue,
        playSounds: newValue > acc.value,
      }),
      { value: 0, playSounds: false },
    ),
    filter((v) => v.playSounds),
  );

  /**
   * Whether we are sharing our screen.
   */
  // reassigned here to make it publicly accessible
  const sharingScreen$ = localMembership.sharingScreen$;

  /**
   * Callback to toggle screen sharing. If null, screen sharing is not possible.
   */
  // reassigned here to make it publicly accessible
  const toggleScreenSharing =
    options.toggleScreensharing ?? localMembership.toggleScreenSharing;

  const errors$ = scope.behavior<{
    transportError?: ElementCallError;
    matrixError?: ElementCallError;
    connectionError?: ElementCallError;
    publishError?: ElementCallError;
  } | null>(
    localMembership.localMemberState$.pipe(
      map((value) => {
        const returnObject: {
          transportError?: ElementCallError;
          matrixError?: ElementCallError;
          connectionError?: ElementCallError;
          publishError?: ElementCallError;
        } = {};
        if (value instanceof ElementCallError) return { transportError: value };
        if (value === TransportState.Waiting) return null;
        if (value.matrix instanceof ElementCallError)
          returnObject.matrixError = value.matrix;
        if (value.media instanceof ElementCallError)
          returnObject.publishError = value.media;
        else if (
          typeof value.media === "object" &&
          value.media.connection instanceof ElementCallError
        )
          returnObject.connectionError = value.media.connection;
        return returnObject;
      }),
    ),
    null,
  );

  return {
    autoLeave$: autoLeave$,
    ringingVm$: ringingMedia$,
    ringingStatusLocation:
      urlParams.header === HeaderStyle.AppBar ? "app_bar" : "tile",
    leave$: leave$,
    hangup: (): void => userHangup$.next(),
    join: localMembership.requestJoinAndPublish,
    leave: localMembership.requestDisconnect,
    toggleScreenSharing: toggleScreenSharing,
    sharingScreen$: sharingScreen$,

    tapScreen: (): void => screenTap$.next(),
    tapControls: (): void => controlsTap$.next(),
    hoverScreen: (): void => screenHover$.next(),
    unhoverScreen: (): void => screenUnhover$.next(),

    fatalError$: scope.behavior(
      errors$.pipe(
        map((errors) => {
          logger.debug("errors$ to compute any fatal errors:", errors);
          return (
            errors?.transportError ??
            errors?.matrixError ??
            errors?.connectionError ??
            null
          );
        }),
        filter((error) => error !== null),
      ),
      null,
    ),
    allConnections$,
    participantCount$: participantCount$,
    keyRotationSuppressed$: keyRotationSuppressed$,
    handsRaised$: handsRaised$,
    reactions$: reactions$,
    joinSoundEffect$: joinSoundEffect$,
    leaveSoundEffect$: leaveSoundEffect$,
    newHandRaised$: newHandRaised$,
    newScreenShare$: newScreenShare$,
    audibleReactions$: audibleReactions$,
    visibleReactions$: visibleReactions$,

    spotlightExpanded$: spotlightExpanded$,
    toggleSpotlightExpanded$: toggleSpotlightExpanded$,
    layoutSwitchVm$: computed(() =>
      showLayoutSwitch$.value ? layoutSwitchVm : null,
    ),
    layout$: layout$,
    localMatrixLivekitMember$,
    remoteMatrixLivekitMembers$: computed(() => {
      const members = remoteMatrixLivekitMembers$.value.value;
      const listForLogs = members
        .map(
          (m) =>
            m.membership$.value.userId + "|" + m.membership$.value.deviceId,
        )
        .join(",");
      logger.debug(`matrixLivekitMembers$ updated (exported) [${listForLogs}]`);
      return members;
    }),
    tileStoreGeneration$: tileStoreGeneration$,
    showSpotlightIndicators$: showSpotlightIndicators$,
    showSpeakingIndicators$: showSpeakingIndicators$,
    showNameTags$,
    showHeader$: showHeader$,
    showFooter$: showFooter$,
    showModals$,
    settingsOpen$: settingsOpen$,
    setSettingsOpen$: setSettingsOpen$,
    edgeToEdge$,
    overflowing$,
    earpieceMode$: earpieceMode$,
    audioOutputSwitcher$: audioOutputSwitcher$,
    reconnecting$: localMembership.reconnecting$,
    livekitRoomItems$,
    connected$: localMembership.connected$,
  };
}

function getE2eeKeyProvider(
  e2eeSystem: EncryptionSystem,
  rtcSession: MatrixRTCSession,
  logger: Logger,
): BaseKeyProvider | undefined {
  if (e2eeSystem.kind === E2eeType.NONE) return undefined;

  if (e2eeSystem.kind === E2eeType.PER_PARTICIPANT) {
    const keyProvider = new MatrixKeyProvider();
    keyProvider.setRTCSession(rtcSession);
    return keyProvider;
  } else if (e2eeSystem.kind === E2eeType.SHARED_KEY && e2eeSystem.secret) {
    const keyProvider = new ExternalE2EEKeyProvider();
    keyProvider
      .setKey(e2eeSystem.secret)
      .catch((e) => logger.error("Failed to set shared key for E2EE", e));
    return keyProvider;
  }
}
