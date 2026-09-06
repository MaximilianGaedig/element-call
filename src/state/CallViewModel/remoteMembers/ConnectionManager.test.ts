/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type LivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc";
import { type RemoteParticipant } from "livekit-client";
import { logger } from "matrix-js-sdk/lib/logger";

import { Scope } from "../../Scope.ts";
import { type LocalTransportWithSFUConfig } from "../localMember/LocalTransport.ts";
import { type SFUConfig } from "../../../livekit/openIDSFU.ts";
import {
  createConnectionManager$,
  type ConnectionManagerData,
} from "./ConnectionManager.ts";
import { type ConnectionFactory } from "./ConnectionFactory.ts";
import { type Connection } from "./Connection.ts";
import { ownMemberMock, withTestScheduler } from "../../../utils/test.ts";
import { areLivekitTransportsEqual } from "./MatrixLivekitMembers.ts";
import { constant, type Behavior, computed } from "../../Behavior.ts";
import { state } from "../../Behavior";

// Some test constants

const TRANSPORT_1: LivekitTransportConfig = {
  type: "livekit",
  livekit_service_url: "https://lk.example.org",
};

const TRANSPORT_2: LivekitTransportConfig = {
  type: "livekit",
  livekit_service_url: "https://lk.sample.com",
};

// The local transport, on an SFU of its own
const LOCAL: LocalTransportWithSFUConfig = {
  transport: { type: "livekit", livekit_service_url: "https://lk.local.test" },
  sfuConfig: { url: "https://lk.local.test", jwt: "jwt" } as SFUConfig,
};

let fakeConnectionFactory: ConnectionFactory;
let testScope: Scope;

// Can be useful to track all created connections in tests, even the disposed ones
let allCreatedConnections: Connection[];

beforeEach(() => {
  testScope = new Scope();
  allCreatedConnections = [];
  fakeConnectionFactory = {} as unknown as ConnectionFactory;
  vi.mocked(fakeConnectionFactory).createConnection = vi
    .fn()
    .mockImplementation((scope: Scope, transport: LivekitTransportConfig) => {
      const mockConnection = {
        transport,
        remoteParticipants$: state([]),
      } as unknown as Connection;
      vi.mocked(mockConnection).start = vi.fn();
      vi.mocked(mockConnection).stop = vi.fn();
      // Tie the connection's lifecycle to the scope to test scope lifecycle management
      scope.onEnd(() => {
        void mockConnection.stop();
      });
      allCreatedConnections.push(mockConnection);
      return mockConnection;
    });
});

afterEach(() => {
  testScope.end();
});

describe("connections$ stream", () => {
  test("Should create and start new connections for each transports", () => {
    withTestScheduler(({ behavior, expectObservable }) => {
      const { connectionManagerData$ } = createConnectionManager$({
        scope: testScope,
        connectionFactory: fakeConnectionFactory,
        localTransport$: constant(LOCAL),
        remoteTransports$: behavior("a", {
          a: [TRANSPORT_1, TRANSPORT_2],
        }),
        logger: logger,
        ownMembershipIdentity: ownMemberMock,
      });

      expectObservable(
        computed(() => connectionManagerData$.value.getConnections()),
      ).toBe("a", {
        a: expect.toSatisfy((connections: Connection[]) => {
          // The local transport's connection and the two remote ones
          expect(connections.length).toBe(3);

          expect(
            vi.mocked(fakeConnectionFactory).createConnection,
          ).toHaveBeenCalledTimes(3);

          const conn1 = connections.find((c) =>
            areLivekitTransportsEqual(c.transport, TRANSPORT_1),
          );
          expect(conn1).toBeDefined();
          expect(conn1!.start).toHaveBeenCalled();

          const conn2 = connections.find((c) =>
            areLivekitTransportsEqual(c.transport, TRANSPORT_2),
          );
          expect(conn2).toBeDefined();
          expect(conn2!.start).toHaveBeenCalled();
          return true;
        }),
      });
    });
  });

  test("Should start connection only once", () => {
    withTestScheduler(({ behavior, expectObservable }) => {
      const { connectionManagerData$ } = createConnectionManager$({
        scope: testScope,
        connectionFactory: fakeConnectionFactory,
        localTransport$: constant(LOCAL),
        remoteTransports$: behavior("abcdef", {
          a: [TRANSPORT_1],
          b: [TRANSPORT_1],
          c: [TRANSPORT_1],
          d: [TRANSPORT_1],
          e: [TRANSPORT_1],
          f: [TRANSPORT_1, TRANSPORT_2],
        }),
        logger: logger,
        ownMembershipIdentity: ownMemberMock,
      });

      expectObservable(
        computed(() => connectionManagerData$.value.getConnections()),
        // Identical transport lists don't produce new connection data
      ).toBe("x----a", {
        x: expect.anything(),
        a: expect.toSatisfy((connections: Connection[]) => {
          expect(connections.length).toBe(3);
          expect(
            vi.mocked(fakeConnectionFactory).createConnection,
          ).toHaveBeenCalledTimes(3);

          const conn2 = connections.find((c) =>
            areLivekitTransportsEqual(c.transport, TRANSPORT_2),
          );
          expect(conn2).toBeDefined();

          const conn1 = connections.find((c) =>
            areLivekitTransportsEqual(c.transport, TRANSPORT_1),
          );
          expect(conn1).toBeDefined();
          expect(conn1!.start).toHaveBeenCalledOnce();

          return true;
        }),
      });
    });
  });

  test("Should hold remote connections back until the local transport is known", () => {
    withTestScheduler(({ behavior, expectObservable }) => {
      const { connectionManagerData$ } = createConnectionManager$({
        scope: testScope,
        connectionFactory: fakeConnectionFactory,
        localTransport$: behavior("a-b", { a: null, b: LOCAL }),
        remoteTransports$: constant([TRANSPORT_1]),
        logger: logger,
        ownMembershipIdentity: ownMemberMock,
      });

      expectObservable(
        computed(() => connectionManagerData$.value.getConnections().length),
      ).toBe("a-b", { a: 0, b: 2 });
    });
  });

  test("Should cleanup connections when not needed anymore", () => {
    withTestScheduler(({ behavior, expectObservable }) => {
      const { connectionManagerData$ } = createConnectionManager$({
        scope: testScope,
        connectionFactory: fakeConnectionFactory,
        localTransport$: constant(LOCAL),
        remoteTransports$: behavior("abc", {
          a: [TRANSPORT_1],
          b: [TRANSPORT_1, TRANSPORT_2],
          c: [TRANSPORT_1],
        }),
        logger: logger,
        ownMembershipIdentity: ownMemberMock,
      });

      expectObservable(
        computed(() => connectionManagerData$.value.getConnections()),
      ).toBe("xab", {
        x: expect.anything(),
        a: expect.toSatisfy((connections: Connection[]) => {
          expect(connections.length).toBe(3);
          return true;
        }),
        b: expect.toSatisfy((connections: Connection[]) => {
          expect(connections.length).toBe(2);
          // The second connection should have been stopped has it is no longer needed.
          const connection2 = allCreatedConnections.find((c) =>
            areLivekitTransportsEqual(c.transport, TRANSPORT_2),
          );
          expect(connection2).toBeDefined();
          expect(connection2!.stop).toHaveBeenCalled();

          // The first connection should still be active
          const conn1 = connections[0];
          expect(conn1.stop).not.toHaveBeenCalledOnce();

          return true;
        }),
      });
    });
  });
});

describe("connectionManagerData$ stream", () => {
  // Used in test to control fake connections' remoteParticipants$ streams
  let fakeRemoteParticipantsStreams: Map<string, Behavior<RemoteParticipant[]>>;

  function keyForTransport(transport: LivekitTransportConfig): string {
    return `${transport.livekit_service_url}`;
  }

  beforeEach(() => {
    fakeRemoteParticipantsStreams = new Map();

    function getRemoteParticipantsFor(
      transport: LivekitTransportConfig,
    ): Behavior<RemoteParticipant[]> {
      return (
        fakeRemoteParticipantsStreams.get(keyForTransport(transport)) ??
        state([])
      );
    }

    // need a more advanced fake connection factory
    vi.mocked(fakeConnectionFactory).createConnection = vi
      .fn()
      .mockImplementation((scope: Scope, transport: LivekitTransportConfig) => {
        const fakeRemoteParticipants$ = state<RemoteParticipant[]>([]);
        const mockConnection = {
          transport,
          remoteParticipants$: getRemoteParticipantsFor(transport),
        } as unknown as Connection;
        vi.mocked(mockConnection).start = vi.fn();
        vi.mocked(mockConnection).stop = vi.fn();
        // Tie the connection's lifecycle to the scope to test scope lifecycle management
        scope.onEnd(() => {
          void mockConnection.stop();
        });

        fakeRemoteParticipantsStreams.set(
          keyForTransport(transport),
          fakeRemoteParticipants$,
        );
        return mockConnection;
      });
  });

  test("Should report connections with the remote participants", () => {
    withTestScheduler(({ expectObservable, schedule, behavior }) => {
      // Setup the fake participants streams behavior
      // ==============================
      fakeRemoteParticipantsStreams.set(
        keyForTransport(TRANSPORT_1),
        behavior("oa-b", {
          o: [],
          a: [{ identity: "user1A" } as RemoteParticipant],
          b: [
            { identity: "user1A" } as RemoteParticipant,
            { identity: "user1B" } as RemoteParticipant,
          ],
        }),
      );

      fakeRemoteParticipantsStreams.set(
        keyForTransport(TRANSPORT_2),
        behavior("o-a", {
          o: [],
          a: [{ identity: "user2A" } as RemoteParticipant],
        }),
      );
      // ==============================

      const { connectionManagerData$ } = createConnectionManager$({
        scope: testScope,
        connectionFactory: fakeConnectionFactory,
        localTransport$: constant(LOCAL),
        remoteTransports$: behavior("a", {
          a: [TRANSPORT_1, TRANSPORT_2],
        }),
        logger,
        ownMembershipIdentity: ownMemberMock,
      });

      expectObservable(connectionManagerData$).toBe("abcd", {
        a: expect.toSatisfy((data: ConnectionManagerData) => {
          expect(data.getConnections().length).toBe(3);
          expect(data.getParticipantsForTransport(TRANSPORT_1).length).toBe(0);
          expect(data.getParticipantsForTransport(TRANSPORT_2).length).toBe(0);
          return true;
        }),
        b: expect.toSatisfy((data: ConnectionManagerData) => {
          expect(data.getConnections().length).toBe(3);
          expect(data.getParticipantsForTransport(TRANSPORT_1).length).toBe(1);
          expect(data.getParticipantsForTransport(TRANSPORT_2).length).toBe(0);
          expect(
            data.getParticipantsForTransport(TRANSPORT_1)[0].identity,
          ).toBe("user1A");
          return true;
        }),
        c: expect.toSatisfy((data: ConnectionManagerData) => {
          expect(data.getConnections().length).toBe(3);
          expect(data.getParticipantsForTransport(TRANSPORT_1).length).toBe(1);
          expect(data.getParticipantsForTransport(TRANSPORT_2).length).toBe(1);
          expect(
            data.getParticipantsForTransport(TRANSPORT_1)[0].identity,
          ).toBe("user1A");
          expect(
            data.getParticipantsForTransport(TRANSPORT_2)[0].identity,
          ).toBe("user2A");
          return true;
        }),
        d: expect.toSatisfy((data: ConnectionManagerData) => {
          expect(data.getConnections().length).toBe(3);
          expect(data.getParticipantsForTransport(TRANSPORT_1).length).toBe(2);
          expect(data.getParticipantsForTransport(TRANSPORT_2).length).toBe(1);
          expect(
            data.getParticipantsForTransport(TRANSPORT_1)[0].identity,
          ).toBe("user1A");
          expect(
            data.getParticipantsForTransport(TRANSPORT_1)[1].identity,
          ).toBe("user1B");
          expect(
            data.getParticipantsForTransport(TRANSPORT_2)[0].identity,
          ).toBe("user2A");
          return true;
        }),
      });
    });
  });
});
