/*
Copyright 2025 Element Creations Ltd.
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type LivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc";
import { type Logger } from "matrix-js-sdk/lib/logger";
import { type RemoteParticipant } from "livekit-client";
import { type CallMembershipIdentityParts } from "matrix-js-sdk/lib/matrixrtc/EncryptionManager";

import { type Behavior, computed } from "../../Behavior.ts";
import { type Connection } from "./Connection.ts";
import { type ObservableScope } from "../../ObservableScope.ts";
import { keyedItems } from "../../keyedItems.ts";
import { areLivekitTransportsEqual } from "./MatrixLivekitMembers.ts";
import { type ConnectionFactory } from "./ConnectionFactory.ts";
import {
  isLocalTransportWithSFUConfig,
  type LocalTransportWithSFUConfig,
} from "../localMember/LocalTransport.ts";
import { type SFUConfig } from "../../../livekit/openIDSFU.ts";

export class ConnectionManagerData {
  private readonly store: Map<
    string,
    { connection: Connection; participants: RemoteParticipant[] }
  > = new Map();

  public constructor() {}

  public add(connection: Connection, participants: RemoteParticipant[]): void {
    const key = this.getKey(connection.transport);
    const existing = this.store.get(key);
    if (!existing) {
      this.store.set(key, { connection, participants });
    } else {
      existing.participants.push(...participants);
    }
  }

  private getKey(transport: LivekitTransportConfig): string {
    // This is enough as a key because the ConnectionManager is already scoped by room.
    // We also do not need to consider the slotId at this point since each `MatrixRTCSession` is already scoped by `slotDescription: {id, application}`.
    return transport.livekit_service_url;
  }

  public getConnections(): Connection[] {
    return Array.from(this.store.values()).map(({ connection }) => connection);
  }

  public getConnectionForTransport(
    transport: LivekitTransportConfig,
  ): Connection | null {
    return this.store.get(this.getKey(transport))?.connection ?? null;
  }

  public getParticipantsForTransport(
    transport: LivekitTransportConfig,
  ): RemoteParticipant[] {
    const key = this.getKey(transport);
    const existing = this.store.get(key);
    if (existing) {
      return existing.participants;
    }
    return [];
  }
}

interface Props {
  scope: ObservableScope;
  connectionFactory: ConnectionFactory;
  localTransport$: Behavior<LocalTransportWithSFUConfig | null>;
  remoteTransports$: Behavior<LivekitTransportConfig[]>;

  logger: Logger;
  ownMembershipIdentity: CallMembershipIdentityParts;
}

// TODO - write test for scopes (do we really need to bind scope)
export interface IConnectionManager {
  connectionManagerData$: Behavior<ConnectionManagerData>;
}

/**
 * Crete a `ConnectionManager`
 * @param props - Configuration object
 * @param props.scope - The observable scope used by this object
 * @param props.connectionFactory - Used to create new connections
 * @param props.localTransport$ - The transport to publish local media on. (deduplicated with remoteTransports$)
 * @param props.remoteTransports$ - All other transports. The connection manager will create connections for each transport. (deduplicated with localTransport$)
 * @param props.ownMembershipIdentity - The own membership identity to use.
 * @param props.logger - The logger to use.

 *
 *   Each of these behaviors can be interpreted as subscribed list of transports.
 *
 *   Using `registerTransports` independent external modules can control what connections
 *   are created by the ConnectionManager.
 *
 *   The connection manager will remove all duplicate transports in each subscibed list.
 *
 *   See `unregisterAllTransports` and `unregisterTransport` for details on how to unsubscribe.
 */
export function createConnectionManager$({
  scope,
  connectionFactory,
  localTransport$,
  remoteTransports$,
  logger: parentLogger,
  ownMembershipIdentity,
}: Props): IConnectionManager {
  const logger = parentLogger.getChild("[ConnectionManager]");
  // TODO logger: only construct one logger from the client and make it compatible via a EC specific sing

  /**
   * All transports currently managed by the ConnectionManager.
   *
   * This list does not include duplicate transports.
   *
   * It is build based on the list of subscribed transports (`transportsSubscriptions$`).
   * externally this is modified via `registerTransports()`.
   */
  const localAndRemoteTransports$ = computed<
    (LivekitTransportConfig | LocalTransportWithSFUConfig)[]
  >(() => {
    // Combine local and remote transports into one transport array
    const localTransport = localTransport$.value;
    const localTransportAsArray = localTransport ? [localTransport] : [];
    const dedupedRemote = removeDuplicateTransports(remoteTransports$.value);
    const remoteWithoutLocal = dedupedRemote.filter(
      (transport) =>
        !localTransportAsArray.find((l) =>
          areLivekitTransportsEqual(l.transport, transport),
        ),
    );
    logger.debug(
      "remoteWithoutLocal",
      remoteWithoutLocal,
      "localTransportAsArray",
      localTransportAsArray,
    );
    return [...localTransportAsArray, ...remoteWithoutLocal];
  });

  /**
   * Connections for each transport in use by one or more session members.
   */
  const connections$ = keyedItems(
    scope,
    "ConnectionManager connections$",
    localAndRemoteTransports$,
    function* (transports) {
      for (const transport of transports) {
        if (isLocalTransportWithSFUConfig(transport)) {
          // This is the local transport; only the `LocalTransportWithSFUConfig` has a `sfuConfig` field.
          yield {
            keys: [
              transport.transport.livekit_service_url,
              transport.sfuConfig,
            ],
            data: undefined,
          };
        } else {
          yield {
            keys: [
              transport.livekit_service_url,
              undefined as SFUConfig | undefined,
            ],
            data: undefined,
          };
        }
      }
    },
    (scope, _data$, serviceUrl, sfuConfig) => {
      const connection = connectionFactory.createConnection(
        scope,
        {
          type: "livekit",
          livekit_service_url: serviceUrl,
        },
        ownMembershipIdentity,
        logger,
        // TODO: This whole optional SFUConfig parameter is not particularly elegant.
        // I would like it if connections always fetched the SFUConfig by themselves.
        sfuConfig,
      );
      // Start the connection immediately
      // Use connection state to track connection progress
      void connection.start();
      // TODO subscribe to connection state to retry or log issues?
      return connection;
    },
  );

  /**
   * The connections, each with the remote participants currently on it.
   */
  const connectionManagerData$ = computed(() => {
    const data = new ConnectionManagerData();
    for (const connection of connections$.value)
      data.add(connection, connection.remoteParticipants$.value);
    return data;
  });

  return { connectionManagerData$ };
}

function removeDuplicateTransports<T extends LivekitTransportConfig>(
  transports: T[],
): T[] {
  return transports.reduce((acc, transport) => {
    if (!acc.some((t) => areLivekitTransportsEqual(t, transport)))
      acc.push(transport);
    return acc;
  }, [] as T[]);
}
