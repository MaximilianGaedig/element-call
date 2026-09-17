/*
Copyright 2025 Element Creations Ltd.
Copyright 2023, 2024, 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type CallMembership } from "matrix-js-sdk/lib/matrixrtc";
import {
  type BaseKeyProvider,
  type ConnectionState,
  ExternalE2EEKeyProvider,
  type Room as LivekitRoom,
  type RoomOptions,
} from "livekit-client";
import { type Room as MatrixRoom } from "matrix-js-sdk";
import { type Logger, logger as rootLogger } from "matrix-js-sdk/lib/logger";
import {
  MembershipManagerEvent,
  type LivekitTransportConfig,
  type MatrixRTCSession,
} from "matrix-js-sdk/lib/matrixrtc";
import { type IWidgetApiRequest } from "matrix-widget-api";
import { type CallMembershipIdentityParts } from "matrix-js-sdk/lib/matrixrtc/EncryptionManager";
import { computeSlotId } from "matrix-js-sdk/lib/matrixrtc/utils";

import { createRecording, type Recording } from "../Recording.ts";
import { createTranscription, type Transcription } from "../Transcription.ts";
import { createDialIn, type DialIn } from "../DialIn.ts";
import { v4 as uuidv4 } from "uuid";

import { duplicateTiles, showReactions } from "../../settings/settings";
import { Config } from "../../config/Config";
import { MatrixRTCMode } from "../../config/ConfigOptions";
import { isFirefox, platform } from "../../Platform";
import { callActive$, pipEnabled$ } from "../../controls";
import { TileStore } from "../TileStore";
import { type GridMove, gridLikeLayout } from "../GridLikeLayout";
import {
  createFloorControl,
  type FloorControl,
  isBlocked,
  mediaId,
} from "../FloorControl.ts";
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
import {
  type Behavior,
  computed,
  constant,
  fromEvents,
  state,
} from "../Behavior";
import { E2eeType } from "../../e2ee/e2eeType";
import { MatrixKeyProvider } from "../../e2ee/matrixKeyProvider";
import { type MuteStates } from "../MuteStates";
import { getUrlParams, HeaderStyle } from "../../UrlParams";
import { type ProcessorState } from "../../livekit/TrackProcessorContext";
import { ElementWidgetActions, widget } from "../../widget";
import {
  layoutShallowEquals,
  type FloatingPosition,
  type MoveTile,
  type Layout,
  type LayoutMedia,
} from "../layout-types.ts";
import { moveMember, type OrderedMember } from "../gridOrder.ts";
import {
  chooseSpotlightSpeaker,
  computeLayoutMedia,
  computeSpotlight,
  type OneOnOneMedia,
} from "../layoutMedia.ts";
import { ElementCallError, UnknownCallError } from "../../utils/errors.ts";
import { type Scope } from "../Scope.ts";
import { keyedItems } from "../keyedItems.ts";
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

// This is the number of participants that we think constitutes a "small" call
// on mobile. No spotlight tile should be shown below this threshold.
// How long the footer should be shown for when hovering over or interacting
// with the interface
const showFooterMs = 4000;

export type WindowMode = "normal" | "narrow" | "flat" | "pip";

/** Why we left the call. */
export type LeaveReason = "user" | "blocked" | AutoLeaveReason;

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
  /**
   * View model for info relating to ringing, timing out, calling back, etc.
   */
  ringingVm$: Behavior<RingingMediaViewModel | null>;
  /**
   * Which visual element the ringing status should be shown in.
   */
  ringingStatusLocation: "app_bar" | "tile";
  /**
   * Why the user should leave the call (hangup pressed, widget action, timeout,
   * decline, everyone else left), once that is the case.
   * THIS DOES NOT LEAVE THE CALL YET. The only way to leave the call (send the hangup event) is
   *  - by ending the scope
   *  - or calling requestDisconnect
   *
   * TODO: it seems more reasonable to add a leave() method (that calls requestDisconnect) that will then update leaveReason$ and remove the hangup pattern
   */
  leaveReason$: Behavior<LeaveReason | null>;
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
  /** How many members have a tile; the rest are bots or hidden. */
  visibleMemberCount$: Behavior<number>;
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
  /**
   * All screen shares in the call.
   */
  screenShares$: Behavior<ScreenShareViewModel[]>;
  /**
   * The reactions that should be visible on the screen.
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
  /**
   * Moderation of devices in the call through room state.
   */
  floorControl: FloorControl;
  /** Recording the call through a bot, where this deployment has one. */
  recording: Recording;
  /** Captioning the call through a bot, where this deployment has one. */
  transcription: Transcription;
  /** Letting people dial in over SIP, where this deployment has a bridge. */
  dialIn: DialIn;
  /**
   * Doubles a tile's size in the grid or the spotlight's rail, or takes that
   * back, at the user's request (double-clicking it).
   */
  toggleTileEnlarged: (tile: GridTileViewModel) => void;
  /**
   * Whether toggleTileEnlarged does anything in the current layout.
   */
  canEnlargeTiles$: Behavior<boolean>;
  /**
   * Whether grid tiles offer pinning from their menu.
   */
  tilePinnable$: Behavior<boolean>;
  /**
   * Pins a user to the spotlight, or unpins them.
   */
  togglePinned: (media: UserMediaViewModel) => void;
  /** Puts `media` where `to` currently sits in the spotlight, when tiled. */
  moveSpotlightItem: (media: MediaViewModel, to: MediaViewModel) => void;
  showSpotlightIndicators$: Behavior<boolean>;
  /**
   * Whether a spotlight holding several media should show them all at once as
   * tiles, rather than paging through them.
   */
  spotlightTiled$: Behavior<boolean>;
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
  moderatorSettingsOpen$: Behavior<boolean>;
  setModeratorSettingsOpen$: Behavior<(open: boolean) => void>;

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
/** Suffix of a second membership a device publishes media through. */
const PUBLISH_SUFFIX = "+publish";
const baseDeviceId = (deviceId: string): string =>
  deviceId.endsWith(PUBLISH_SUFFIX)
    ? deviceId.slice(0, -PUBLISH_SUFFIX.length)
    : deviceId;

export function createCallViewModel$(
  scope: Scope,
  // A call is permanently tied to a single Matrix room
  matrixRTCSession: MatrixRTCSession,
  matrixRoom: MatrixRoom,
  mediaDevices: MediaDevices,
  muteStates: MuteStates,
  options: CallViewModelOptions,
  handsRaisedSubject$: Behavior<Record<string, RaisedHandInfo>>,
  reactionsSubject$: Behavior<Record<string, ReactionInfo>>,
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

  /**
   * How loud we are: a multiplier applied to our microphone before it's
   * published. Purely local; nothing to do with floor control.
   */
  const micGain$ = state(1);

  // ------------------------------------------------------------------------
  // floorControl: moderators muting devices through room state
  const slotId = computeSlotId(matrixRTCSession.slotDescription);
  const floorControl = createFloorControl(scope, matrixRoom, userId, slotId);
  const dialIn = createDialIn(
    scope,
    matrixRoom,
    floorControl,
    Config.get().sip_bridge,
  );

  // ------------------------------------------------------------------------
  // memberships$
  // Devices a moderator has blocked are treated as not being in the session
  // at all: no tiles, no media, no connection to their SFU. Everything below
  // derives from this list, so filtering here is enough, and a block being
  // lifted brings them back exactly as if they'd just joined.
  // A device that also publishes through a second, "+publish" membership
  // (as a SIP bridge does) has its media there, so its plain membership
  // would be an empty tile; and an embedder rendering the call for someone
  // who shouldn't see themselves can hide everything from this device.
  const allMemberships$ = createMemberships$(scope, matrixRTCSession);
  const memberships$ = computed<CallMembership[]>(() => {
    const content = floorControl.content$.value;
    const all = allMemberships$.value;
    const publishingTwins = new Set(
      all
        .filter((m) => m.deviceId.endsWith(PUBLISH_SUFFIX))
        .map((m) => `${m.userId}:${baseDeviceId(m.deviceId)}`),
    );
    const { hideLocalTiles } = getUrlParams();
    return all.filter(
      (m) =>
        !isBlocked(content, m.userId, m.deviceId) &&
        !publishingTwins.has(`${m.userId}:${m.deviceId}`) &&
        !(
          hideLocalTiles &&
          m.userId === userId &&
          baseDeviceId(m.deviceId) === deviceId
        ),
    );
  }, shallowArrayEquals);
  /**
   * The bots this deployment knows and the bridges a moderator has enabled.
   * They join like anyone else, but aren't people.
   */
  const configuredBots$ = computed(
    () =>
      new Set(
        [
          ...Object.keys(floorControl.content$.value.bridges ?? {}),
          Config.get().recording_bot,
          Config.get().transcription_bot,
          Config.get().sip_bridge,
        ].filter((id) => id !== undefined),
      ),
  );
  // Recording the call through a bot, where this deployment has one. Only
  // people can consent to it, through their memberships.
  const recording = createRecording(
    scope,
    matrixRoom,
    floorControl,
    slotId,
    Config.get().recording_bot,
    options.encryptionSystem,
    matrixRTCSession,
    memberships$,
    configuredBots$,
  );
  const transcription = createTranscription(
    scope,
    matrixRoom,
    floorControl,
    slotId,
    Config.get().transcription_bot,
    options.encryptionSystem,
  );
  // Our own device honours a moderator's audio mute by not publishing. A
  // video mute is only applied by viewers, who hide the video; our camera
  // stays as it is and the local tile warns that nobody can see it.
  const localModeration$ = floorControl.moderation$(
    mediaId(userId, deviceId),
    userId,
  );
  scope.effect(() => {
    muteStates.audio.setModeratorMuted(localModeration$.value.audioMuted);
  });

  // ------------------------------------------------------------------------
  // matrixLivekitMembers$ AND localMembership

  const membershipsAndTransports = membershipsAndTransports$(memberships$);

  const ownMembershipIdentity: CallMembershipIdentityParts = {
    userId,
    deviceId,
    // This will only be consumed by the sticky membership manager. So it has no impact on legacy calls.
    memberId: uuidv4(),
  };

  // Re-create LocalTransport whenever the mode changes
  const localTransports$ = keyedItems(
    scope,
    "CallViewModel localTransport$",
    matrixRTCMode$,
    (mode) => [{ keys: [mode], data: undefined }],
    (scope, _data$, mode) =>
      options.localTransport ??
      createLocalTransport$({
        scope: scope,
        ownMembershipIdentity,
        client,
        delayId$: fromEvents(
          scope,
          matrixRTCSession,
          [MembershipManagerEvent.DelayIdChanged],
          (session) => session.delayId ?? null,
        ),
        roomId: matrixRoom.roomId,
        forceJwtEndpoint:
          mode === MatrixRTCMode.Matrix_2_0
            ? JwtEndpointVersion.Matrix_2_0
            : JwtEndpointVersion.Legacy,
      }),
  );
  const localTransport$ = computed(() => localTransports$.value[0]);

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
    localTransport$: computed(() => localTransport$.value.active$.value),
    remoteTransports$: membershipsAndTransports.transports$,
    logger: logger,
    ownMembershipIdentity,
  });

  const remoteMatrixLivekitMembers$: Behavior<RemoteMatrixLivekitMember[]> =
    createRemoteMatrixLivekitMembers$({
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
        micGain$,
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
      memberships$.value.find(
        (membership) =>
          membership.userId === userId && membership.deviceId === deviceId,
      ) ?? null,
  );

  // The local member exists for as long as we have a membership; its
  // membership$ follows ours over that time.
  const localMatrixLivekitMembers$ = keyedItems(
    scope,
    "CallViewModel localMatrixLivekitMember$",
    localRtcMembership$,
    (membership) =>
      membership === null
        ? []
        : [{ keys: ["local"] as const, data: membership }],
    (_scope, membership$): LocalMatrixLivekitMember => ({
      membership$,
      participant: {
        type: "local" as const,
        value$: localMembership.participant$,
      },
      connection$: localMembership.connection$,
      userId,
    }),
  );
  const localMatrixLivekitMember$ = computed(
    () => localMatrixLivekitMembers$.value[0] ?? null,
  );

  const matrixLivekitMembers$ = computed(() => {
    const local = localMatrixLivekitMember$.value;
    return [
      ...(local === null ? [] : [local]),
      ...remoteMatrixLivekitMembers$.value,
    ];
  });

  // ------------------------------------------------------------------------
  // matrixMemberMetadataStore

  const matrixRoomMembers$ = createRoomMembers$(scope, matrixRoom);
  const matrixMemberMetadataStore = createMatrixMemberMetadata$(
    memberships$,
    matrixRoomMembers$,
  );

  // ------------------------------------------------------------------------
  // callLifecycle

  // TODO if we are in "unknown" state we need a loading rendering (or empty screen)
  // Otherwise it looks like we already connected and only than the ringing starts which is weird.
  const { ringAttempt$, autoLeaveReason$ } = createCallNotificationLifecycle$({
    scope,
    memberships$,
    matrixRoomMembers$,
    sentCallNotification$: createSentCallNotification$(scope, matrixRTCSession),
    matrixRoom,
    options,
    localUser: { userId, deviceId },
  });

  const allConnections$ = connectionManager.connectionManagerData$;
  /**
   * The remote participants to render audio for, grouped by LiveKit room.
   */
  const livekitRoomItems$ = computed<LivekitRoomItem[]>(() => {
    const items: LivekitRoomItem[] = [];
    for (const member of remoteMatrixLivekitMembers$.value) {
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

  // Reactions and raised hands hold still while we're reconnecting
  const handsRaised$ = pauseWhile(
    scope,
    handsRaisedSubject$,
    localMembership.reconnecting$,
  );
  const reactions$ = pauseWhile(
    scope,
    computed(() =>
      Object.fromEntries(
        Object.entries(reactionsSubject$.value).map(
          ([a, { reactionOption }]) => [a, reactionOption],
        ),
      ),
    ),
    localMembership.reconnecting$,
  );

  /**
   * IDs of the user media the local user has pinned to the spotlight (by
   * double-clicking their tile or choosing Pin from its menu).
   */
  const pinnedIds$ = state<ReadonlySet<string>>(new Set());
  const togglePinned = (media: UserMediaViewModel): void => {
    const next = new Set(pinnedIds$.peek());
    if (!next.delete(media.id)) next.add(media.id);
    pinnedIds$.value = next;
  };

  /**
   * All user media (camera feeds) in the call, before auditorium mode hides
   * any.
   */
  const allUserMedia$ = keyedItems(
    scope,
    "CallViewModel userMedia$",
    computed(
      () => [matrixLivekitMembers$.value, duplicateTiles.value$.value] as const,
    ),
    // Generate a collection of user media from the list of expected (whether
    // present or missing) LiveKit participants.
    function* ([members, duplicateTiles]) {
      for (const { userId, participant, connection$, membership$ } of members) {
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
    (scope, _, dup, mediaId, userId, participant, connection$, rtcId) => {
      const moderation$ = floorControl.moderation$(mediaId, userId);
      return createWrappedUserMedia(scope, {
        id: `${mediaId}:${dup}`,
        duplicate: dup > 0,
        micGain$,
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
          const name$ = matrixMemberMetadataStore.displayName$(userId);
          return computed(() => name$.value ?? userId);
        })(),
        mxcAvatarUrl$: matrixMemberMetadataStore.avatarUrl$(userId),
        moderation$,
        // Moderating yourself is what the mute buttons are for
        moderator$:
          participant.type === "local"
            ? constant(null)
            : floorControl.moderator$(mediaId, userId),
        memberActions$: floorControl.memberActions$(userId),
        isModerator$: floorControl.isModerator$(userId),
        // Pinned locally, or for everyone by a moderator
        pinned$: computed(
          () =>
            pinnedIds$.value.has(`${mediaId}:${dup}`) ||
            moderation$.value.pinned,
        ),
        handRaised$: computed(() => handsRaised$.value[mediaId]?.time ?? null),
        handRaisedOrder$: computed(() => {
          const hands = handsRaised$.value;
          const mine = hands[mediaId];
          if (mine === undefined) return null;
          const all = Object.values(hands);
          if (all.length < 2) return null;
          return all.filter((h) => h.time < mine.time).length + 1;
        }),
        reaction$: computed(() => reactions$.value[mediaId] ?? undefined),
      });
    },
  );

  /**
   * The bots in the call: the configured ones and the recorder named while
   * a recording runs. (The SIP callers a bridge brings in are separate
   * users, so they show.) The configured ones are hidden even when idle,
   * since a bot's several memberships linger for a moment after the state
   * naming it is cleared.
   */
  const botUserIds$ = computed(() => {
    const recorder = recording.recording$.value?.recorder;
    return recorder === undefined
      ? configuredBots$.value
      : new Set([...configuredBots$.value, recorder]);
  });
  /**
   * The user media we want tiles for. Auditorium mode hides the tiles of
   * users below a power level, bots get no tile, and we see ourselves unless
   * the embedder asked not to (hideLocalTiles).
   */
  const userMedia$ = computed<WrappedUserMediaViewModel[]>(
    () =>
      allUserMedia$.value.filter((m) =>
        m.local
          ? !getUrlParams().hideLocalTiles
          : !m.moderation$.value.hidden && !botUserIds$.value.has(m.userId),
      ),
    shallowArrayEquals,
  );

  // Placeholder media for the person we're ringing, until they answer
  const ringingMediaItems$ = keyedItems(
    scope,
    "CallViewModel ringingMedia$",
    computed(() => {
      const attempt = ringAttempt$.value;
      const outcome = attempt?.outcome$.value;
      return attempt && outcome !== undefined && outcome !== "accept"
        ? { intent: attempt.intent, recipient: attempt.recipient, outcome }
        : null;
    }),
    (attempt) =>
      attempt === null
        ? []
        : [
            {
              keys: [attempt.intent, attempt.recipient] as const,
              data: attempt.outcome,
            },
          ],
    (_scope, pickupState$, intent, userId) =>
      createRingingMedia({
        id: `ringing:${userId}`,
        userId,
        displayName$: computed(
          () => matrixRoomMembers$.value.get(userId)?.rawDisplayName || userId,
        ),
        mxcAvatarUrl$: matrixMemberMetadataStore.avatarUrl$(userId),
        pickupState$,
        intent,
      }),
  );
  const ringingMedia$ = computed<RingingMediaViewModel | null>(
    () => ringingMediaItems$.value[0] ?? null,
  );

  /**
   * All screen share media that we want to display.
   */
  const screenShares$ = computed<ScreenShareViewModel[]>(() =>
    userMedia$.value.flatMap((m) => m.screenShares$.value),
  );

  /**
   * The number of participants currently in the call.
   *
   *  - Each participant has a corresponding MatrixRTC membership state event
   *  - There can be multiple participants for one Matrix user if they join from
   *    multiple devices.
   */
  const participantCount$ = computed(() => matrixLivekitMembers$.value.length);
  const visibleMemberCount$ = computed(() => userMedia$.value.length);

  const keyRotationSuppressed$ = createKeyRotationSuppressed$(
    scope,
    matrixRTCSession,
  );

  // Why we should leave the call, once we should. The first reason wins.
  const leaveReason$ = state<LeaveReason | null>(null);
  const leave = (reason: LeaveReason): void => {
    if (leaveReason$.peek() === null) leaveReason$.value = reason;
  };
  scope.effect(() => {
    const reason = autoLeaveReason$.value;
    if (reason !== null) leave(reason);
  });
  // If we're the one blocked, we leave (and the lobby won't let us back in
  // until the block is lifted)
  scope.effect(() => {
    if (localModeration$.value.blocked) leave("blocked");
  });
  if (widget !== null) {
    const onHangup = (ev: CustomEvent<IWidgetApiRequest>): void => {
      widget!.api.transport.reply(ev.detail, {});
      leave("user");
    };
    widget.lazyActions.on(ElementWidgetActions.HangupCall, onHangup);
    scope.onEnd(() =>
      widget!.lazyActions.off(ElementWidgetActions.HangupCall, onHangup),
    );
  }

  /**
   * Users pinned to the spotlight, excluding any who have since left.
   */
  const pinned$ = computed<WrappedUserMediaViewModel[]>(
    () => userMedia$.value.filter((m) => m.pinned$.value),
    shallowArrayEquals,
  );

  // The previous pick is fed back in, so this is a state written by an effect
  // rather than a computed (computeds must be pure). Pinned users are shown
  // regardless, so they're not candidates: the speaker slot goes to whoever
  // would otherwise have had it.
  const spotlightSpeaker$ = state<WrappedUserMediaViewModel | undefined>(
    undefined,
  );
  scope.effect(() => {
    const pinned = pinned$.value;
    spotlightSpeaker$.value = chooseSpotlightSpeaker(
      spotlightSpeaker$.peek(),
      userMedia$.value
        .filter((m) => !pinned.includes(m))
        .map((m) => ({ media: m, speaking: m.speaking$.value })),
      // With people pinned, nobody needs to be spotlit just to fill the space
      pinned.length === 0,
    );
  });

  /**
   * Whether the user has placed the local tile (or displaced it) by dragging,
   * releasing it from its usual pinned spot.
   */
  const localTileMoved$ = state(false);

  /**
   * The user media to show in the grid (or in the thumbnails next to the
   * spotlight), with what the layout needs to know to order them.
   */
  const gridMembers$ = computed<OrderedMember<UserMediaViewModel>[]>(() =>
    userMedia$.value.map((m) => ({
      media: m,
      // The local tile keeps to an end of the grid, until the user drags it
      // (or something onto it) somewhere in particular
      pin:
        m.local && !localTileMoved$.value
          ? m.alwaysShow$.value
            ? "first"
            : "last"
          : undefined,
      presenting: m.screenShares$.value.length > 0,
      handRaised: m.handRaised$.value !== null,
      speaking: m.isSpeaker$.value && m.speaking$.value,
      video: m.videoEnabled$.value,
      lastActive: m.lastActive$.value,
    })),
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

  const spotlightAndPip$ = computed(() =>
    computeSpotlight({
      ringing: ringingMedia$.value,
      screenShares: screenShares$.value,
      speaker: spotlightSpeaker$.value,
      pinned: pinned$.value,
      localPip: localUserMediaForPip$.value,
    }),
  );

  /**
   * Media IDs in the order the user has dragged them into within the
   * spotlight. Anything not listed keeps its natural place after them.
   */
  const spotlightOrder$ = state<readonly string[]>([]);

  /**
   * The media to show in the spotlight.
   */
  const spotlight$ = computed<MediaViewModel[]>(() => {
    const order = spotlightOrder$.value;
    const natural = spotlightAndPip$.value.spotlight;
    const rank = (m: MediaViewModel, i: number): number => {
      const r = order.indexOf(m.id);
      return r === -1 ? order.length + i : r;
    };
    return natural
      .map((m, i) => [m, rank(m, i)] as const)
      .sort(([, a], [, b]) => a - b)
      .map(([m]) => m);
  }, shallowArrayEquals);

  const moveSpotlightItem = (
    media: MediaViewModel,
    to: MediaViewModel,
  ): void => {
    spotlightOrder$.value = moveMember(spotlight$.peek(), media, to).map(
      (m) => m.id,
    );
  };

  /**
   * The media to show in the picture-in-picture tile of the expanded spotlight
   * layout.
   */
  const spotlightPip$ = computed<UserMediaViewModel | undefined>(
    () => spotlightAndPip$.value.pip,
  );

  const hasScreenShares$ = computed(() => screenShares$.value.length > 0);

  // Let the embedding app know that its picture-in-picture controls can be used
  callActive$.value = true;
  scope.onEnd(() => {
    callActive$.value = false;
    pipEnabled$.value = false;
  });

  const windowSize$ = options.windowSize$ ?? createWindowSize$(scope);

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
    hasScreenShares$,
  );

  const oneOnOneLayoutMedia$ = computed<OneOnOneMedia | null>(() => {
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
  const layoutMedia$ = computed<LayoutMedia>(() =>
    computeLayoutMedia({
      windowMode: windowMode$.value,
      layoutMode: layoutSwitchVm.layout$.value,
      spotlightExpanded: spotlightExpanded$.value,
      oneOnOne: oneOnOneLayoutMedia$.value,
      localVideoEnabled:
        oneOnOneLayoutMedia$.value?.local.videoEnabled$.value ?? false,
      spotlight: spotlight$.value,
      grid: gridMembers$.value,
      pip: spotlightPip$.value,
      desktop: platform === "desktop",
    }),
  );

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

  // Only the landscape spotlight has room to tile; the grid layout's floating
  // spotlight and the portrait layout's strip are too small
  const spotlightTiled$ = computed(
    () => layoutMedia$.value.type === "spotlight-landscape",
  );

  const showSpeakingIndicators$ = computed<boolean>(() => {
    const l = layoutMedia$.value;
    switch (l.type) {
      case "spotlight-landscape":
      case "spotlight-portrait":
        // If the spotlight is showing only the active speaker, we can do
        // without speaking indicators as they're a redundant visual cue. But
        // if screen sharing feeds or pinned users share the spotlight we
        // still need them.
        return (
          l.spotlight.length > 1 ||
          l.spotlight.some((m) => m.type === "screen share")
        );
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

  // In edge-to-edge layouts the footer is an overlay that shows and hides in
  // response to interactions, unless we're in a mode where that isn't wanted.
  const naturallyShowFooter$ = state(true);
  let footerInteractive = false;
  let footerTimeout: ReturnType<typeof setTimeout> | undefined;
  let hideFooterOnUnhover = false;
  // Hide after a timeout only in flat windows
  let footerTimeoutMs: number | null = null;
  const showFooterFor = (ms: number | null): void => {
    naturallyShowFooter$.value = true;
    clearTimeout(footerTimeout);
    if (ms !== null)
      footerTimeout = setTimeout(() => {
        naturallyShowFooter$.value = false;
      }, ms);
  };
  scope.effect(() => {
    const mode = windowMode$.value;
    clearTimeout(footerTimeout);
    hideFooterOnUnhover = false;
    // Sadly Firefox has some layering glitches that prevent the footer
    // from appearing properly. They happen less often if we never hide
    // the footer.
    if (!edgeToEdge$.value || isFirefox()) {
      footerInteractive = false;
      naturallyShowFooter$.value = true;
    } else if (mode === "pip" && platform !== "desktop") {
      // No controls are shown in mobile pip as interactions are disabled
      footerInteractive = false;
      naturallyShowFooter$.value = false;
    } else {
      footerInteractive = true;
      footerTimeoutMs = mode === "flat" ? showFooterMs : null;
      naturallyShowFooter$.value = mode !== "flat";
    }
  });
  scope.onEnd(() => clearTimeout(footerTimeout));
  const tapScreen = (): void => {
    if (!footerInteractive) return;
    hideFooterOnUnhover = false;
    // Toggle visibility on tap
    if (naturallyShowFooter$.value) {
      clearTimeout(footerTimeout);
      naturallyShowFooter$.value = false;
    } else showFooterFor(footerTimeoutMs);
  };
  const tapControls = (): void => {
    if (!footerInteractive) return;
    // The user is interacting with things, so reset the timeout
    hideFooterOnUnhover = false;
    showFooterFor(footerTimeoutMs);
  };
  const hoverScreen = (): void => {
    if (!footerInteractive) return;
    // Show on hover and hide after a timeout or when the hover ends
    hideFooterOnUnhover = true;
    showFooterFor(footerTimeoutMs);
  };
  const unhoverScreen = (): void => {
    if (!hideFooterOnUnhover) return;
    hideFooterOnUnhover = false;
    clearTimeout(footerTimeout);
    naturallyShowFooter$.value = false;
  };

  const urlParams = getUrlParams();
  const showFooterUrlParams = !(
    urlParams.header === HeaderStyle.None && urlParams.showControls === false
  );
  const showFooter$ = computed(
    () => naturallyShowFooter$.value && showFooterUrlParams,
  );

  const showModals$ = computed(() => windowMode$.value !== "pip");

  const moderatorSettingsOpen$ = state(false);
  const setModeratorSettingsOpen$ = constant((open: boolean) => {
    moderatorSettingsOpen$.value = open;
  });
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
   * The position of the floating spotlight tile, if present.
   */
  const spotlightPosition$ = state<FloatingPosition>({
    x: Infinity,
    y: Infinity,
  });
  /**
   * The size of the small picture-in-picture tile, if present, when in portrait.
   */
  const portraitPipSize$ = computed(() => (showFooter$.value ? "lg" : "sm"));
  /**
   * The position of the small picture-in-picture tile, if present, when in portrait.
   */
  const portraitPipPosition$ = state<FloatingPosition>({
    x: Infinity,
    y: Infinity,
  });
  /**
   * The width of the rail of grid tiles beside the spotlight in the landscape
   * spotlight layout, which the user can drag to resize. Starts at the rail's
   * minimum width (see SpotlightLandscapeLayout), which was its fixed width.
   */
  const spotlightRailWidth$ = state(180);
  /**
   * The position of the small picture-in-picture tile, if present, when in landscape.
   */
  const landscapePipPosition$ = state<FloatingPosition>({
    x: Infinity,
    y: 0,
  });

  // There is a cyclical dependency here: the layout algorithms want to know
  // which tiles are on screen, but to know which tiles are on screen we have to
  // first render a layout. To deal with this we assume initially that all tiles
  // are visible, and loop the data back into the layouts through a State.
  const visibleTiles$ = state(Infinity);
  const setVisibleTiles = (value: number): void => {
    visibleTiles$.value = value;
  };

  // The user can drag a tile onto another's spot to rearrange the grid. The
  // move is a one-shot input to the layout effect below: it's applied to the
  // previous order once, after which the new order lives in the tile store like
  // any other. A counter wakes the effect rather than the move itself so that
  // consuming the move doesn't re-trigger it.
  let pendingMove: GridMove | null = null;
  const moves$ = state(0);
  const moveTile: MoveTile = (tile, to) => {
    const media = tile.media$.peek();
    const toMedia = to.media$.peek();
    if (media.type === "ringing" || toMedia.type === "ringing") return;
    if (
      (media.type === "user" && media.local) ||
      (toMedia.type === "user" && toMedia.local)
    )
      localTileMoved$.value = true;
    pendingMove = { media, to: toMedia };
    moves$.value++;
  };

  // This is an effect rather than a computed because the TileStore mutates the
  // tile view models it reuses
  const layoutInternals$ = state<LayoutInternals | null>(null);
  scope.effect(() => {
    const media = layoutMedia$.value;
    const visibleTiles = visibleTiles$.value;
    void moves$.value; // wake up on each move
    const move = pendingMove;
    pendingMove = null;
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
          {
            spotlightPosition$,
            railWidth$: spotlightRailWidth$,
            visibleTiles,
            setVisibleTiles,
            moveTile,
            move,
          },
          prevTiles,
        );
        overflowing = tiles.gridTiles.length > visibleTiles;
        break;
      case "spotlight-expanded":
        [layout, tiles] = spotlightExpandedLayout(
          media,
          landscapePipPosition$,
          prevTiles,
        );
        break;
      case "one-on-one-desktop":
        [layout, tiles] = oneOnOneDesktopLayout(
          media,
          landscapePipPosition$,
          prevTiles,
        );
        pip = layout.pip;
        break;
      case "one-on-one-mobile":
        [layout, tiles] = oneOnOneMobileLayout(
          media,
          portraitPipSize$,
          portraitPipPosition$,
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

  const gridLikeLayout$ = computed(() => {
    const type = layoutMedia$.value.type;
    return (
      type === "grid" ||
      type === "spotlight-landscape" ||
      type === "spotlight-portrait"
    );
  });
  const toggleTileEnlarged = (tile: GridTileViewModel): void => {
    if (gridLikeLayout$.peek()) tile.toggleEnlarged();
  };

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
  const earpieceMode$ = computed(() => {
    const selected = mediaDevices.audioOutput.selected$.value;
    return (
      selected !== undefined &&
      mediaDevices.audioOutput.available$.value.get(selected.id)?.type ===
        "earpiece"
    );
  });

  /**
   * Callback to toggle between the earpiece and the loudspeaker.
   *
   * This will be `null` in case the target does not exist in the list
   * of available audio outputs.
   */
  const audioOutputSwitcher$ = computed<{
    targetOutput: "earpiece" | "speaker";
    switch: () => void;
  } | null>(() => {
    const available = mediaDevices.audioOutput.available$.value;
    const selected = mediaDevices.audioOutput.selected$.value;
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
  });

  /**
   * The reactions that should be visible on the screen. Each sender's reaction
   * keeps its horizontal position for as long as it is showing.
   */
  // DISCUSSION move this into a reaction file
  const reactionStartX = new Map<string, number>();
  const visibleReactions$ = computed<
    { sender: string; emoji: string; startX: number }[]
  >(() => {
    const reactions = showReactions.value$.value ? reactions$.value : {};
    for (const sender of reactionStartX.keys())
      if (!(sender in reactions)) reactionStartX.delete(sender);
    return Object.entries(reactions).map(([sender, reaction]) => {
      let startX = reactionStartX.get(sender);
      if (startX === undefined) {
        startX = Math.ceil(Math.random() * 80) + 10;
        reactionStartX.set(sender, startX);
      }
      return { sender, emoji: reaction.emoji, startX };
    });
  });

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

  const errors$ = computed<{
    transportError?: ElementCallError;
    matrixError?: ElementCallError;
    connectionError?: ElementCallError;
    publishError?: ElementCallError;
  } | null>(() => {
    const value = localMembership.localMemberState$.value;
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
  });

  // Once a fatal error has occurred it stays, even if the state moves on
  const fatalError$ = state<ElementCallError | null>(null);
  scope.effect(() => {
    const errors = errors$.value;
    logger.debug("errors$ to compute any fatal errors:", errors);
    const error =
      errors?.transportError ??
      errors?.matrixError ??
      errors?.connectionError ??
      null;
    if (error !== null) fatalError$.value = error;
  });

  return {
    ringingVm$: ringingMedia$,
    ringingStatusLocation:
      urlParams.header === HeaderStyle.AppBar ? "app_bar" : "tile",
    leaveReason$,
    hangup: (): void => leave("user"),
    join: localMembership.requestJoinAndPublish,
    leave: localMembership.requestDisconnect,
    toggleScreenSharing: toggleScreenSharing,
    sharingScreen$: sharingScreen$,

    tapScreen,
    tapControls,
    hoverScreen,
    unhoverScreen,

    fatalError$,
    allConnections$,
    participantCount$: participantCount$,
    visibleMemberCount$,
    keyRotationSuppressed$: keyRotationSuppressed$,
    handsRaised$: handsRaised$,
    reactions$: reactions$,
    screenShares$,
    visibleReactions$: visibleReactions$,

    spotlightExpanded$: spotlightExpanded$,
    toggleSpotlightExpanded$: toggleSpotlightExpanded$,
    layoutSwitchVm$: computed(() =>
      showLayoutSwitch$.value ? layoutSwitchVm : null,
    ),
    layout$: layout$,
    localMatrixLivekitMember$,
    remoteMatrixLivekitMembers$: computed(() => {
      const members = remoteMatrixLivekitMembers$.value;
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
    floorControl,
    recording,
    transcription,
    dialIn,
    toggleTileEnlarged,
    togglePinned,
    moveSpotlightItem,
    canEnlargeTiles$: gridLikeLayout$,
    tilePinnable$: computed(() => {
      const type = layoutMedia$.value.type;
      return type === "spotlight-landscape" || type === "spotlight-portrait";
    }),
    showSpotlightIndicators$: showSpotlightIndicators$,
    spotlightTiled$,
    showSpeakingIndicators$: showSpeakingIndicators$,
    showNameTags$,
    showHeader$: showHeader$,
    showFooter$: showFooter$,
    showModals$,
    settingsOpen$: settingsOpen$,
    setSettingsOpen$: setSettingsOpen$,
    moderatorSettingsOpen$,
    setModeratorSettingsOpen$,
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

/**
 * A Behavior that stops following `value$` while `pause$` is true, and catches
 * up with the latest value once it is false again.
 */
function pauseWhile<T>(
  scope: Scope,
  value$: Behavior<T>,
  pause$: Behavior<boolean>,
): Behavior<T> {
  const paused$ = state(value$.value);
  scope.effect(() => {
    const value = value$.value;
    if (!pause$.value) paused$.value = value;
  });
  return paused$;
}

function createWindowSize$(
  scope: Scope,
): Behavior<{ width: number; height: number }> {
  const read = (): { width: number; height: number } => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const size$ = state(read());
  scope.effect(() => {
    const onResize = (): void => {
      size$.value = read();
    };
    window.addEventListener("resize", onResize);
    return (): void => window.removeEventListener("resize", onResize);
  });
  return size$;
}
