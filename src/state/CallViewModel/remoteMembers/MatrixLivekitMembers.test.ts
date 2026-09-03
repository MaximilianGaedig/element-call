/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  type CallMembership,
  type LivekitTransport,
} from "matrix-js-sdk/lib/matrixrtc";

import { type IConnectionManager } from "./ConnectionManager.ts";
import {
  type RemoteMatrixLivekitMember,
  createRemoteMatrixLivekitMembers$,
} from "./MatrixLivekitMembers.ts";
import { ObservableScope } from "../../ObservableScope.ts";
import { ConnectionManagerData } from "./ConnectionManager.ts";
import {
  flushPromises,
  mockRtcMembership,
  mockRemoteParticipant,
} from "../../../utils/test.ts";
import { type Connection } from "./Connection.ts";
import { type Behavior, computed, constant } from "../../Behavior.ts";
import { localRtcMember } from "../../../utils/test-fixtures.ts";
import { state } from "../../Behavior";

let testScope: ObservableScope;

const fallbackMemberId = (userId: string, deviceId: string): string =>
  `${userId}:${deviceId}`;

const transportA: LivekitTransport = {
  type: "livekit",
  livekit_service_url: "https://lk.example.org",
  livekit_alias: "!alias:example.org",
};

const transportB: LivekitTransport = {
  type: "livekit",
  livekit_service_url: "https://lk.sample.com",
  livekit_alias: "!alias:sample.com",
};

const bobMembership = mockRtcMembership("@bob:example.org", "DEV000", {
  fociPreferred: [transportA],
});
const carlMembership = mockRtcMembership("@carl:sample.com", "DEV111", {
  fociPreferred: [transportB],
});

beforeEach(() => {
  testScope = new ObservableScope();
});

afterEach(() => {
  testScope.end();
});

test("should signal participant not yet connected to livekit", async () => {
  const mockedMemberships$ = state([bobMembership]);
  const mockConnectionManagerData$ = state(new ConnectionManagerData());
  const membershipsWithTransport$ =
    createMembershipsWithTransport$(mockedMemberships$);

  const connectionManagerData$ = mockConnectionManagerData$;

  const remoteMatrixLivekitMembers$ = createRemoteMatrixLivekitMembers$({
    scope: testScope,
    membershipsWithTransport$,
    connectionManager: {
      connectionManagerData$: connectionManagerData$,
    } as unknown as IConnectionManager,
    localUser: localRtcMember,
  });

  await flushPromises();
  expect(remoteMatrixLivekitMembers$.value).toSatisfy(
    (data: RemoteMatrixLivekitMember[]) => {
      expect(data.length).toEqual(1);
      expect(data[0].membership$.value).toBe(bobMembership);
      expect(data[0].participant.value$.value).toBe(null);
      expect(data[0].connection$.value).toBe(null);
      return true;
    },
  );
});

// Helper to create membershipsWithTransport$ from memberships.
function createMembershipsWithTransport$(
  memberships$: Behavior<CallMembership[]>,
): Behavior<{ membership: CallMembership; transport?: LivekitTransport }[]> {
  return computed(() =>
    memberships$.value.map((m) => {
      const tr = m.getTransport(m);
      return {
        membership: m,
        transport:
          tr?.type === "livekit" ? (tr as LivekitTransport) : undefined,
      };
    }),
  );
}

test("should signal participant on a connection that is publishing", async () => {
  const bobParticipantId = fallbackMemberId(
    bobMembership.userId,
    bobMembership.deviceId,
  );

  const membershipsWithTransport$ = createMembershipsWithTransport$(
    constant([bobMembership]),
  );

  const connection = {
    transport: bobMembership.getTransport(bobMembership),
  } as unknown as Connection;
  const dataWithPublisher = new ConnectionManagerData();
  dataWithPublisher.add(connection, [
    mockRemoteParticipant({ identity: bobParticipantId }),
  ]);

  const connectionManagerData$ = constant(dataWithPublisher);

  const remoteMatrixLivekitMembers$ = createRemoteMatrixLivekitMembers$({
    scope: testScope,
    membershipsWithTransport$,
    connectionManager: {
      connectionManagerData$: connectionManagerData$,
    } as unknown as IConnectionManager,
    localUser: localRtcMember,
  });

  await flushPromises();
  expect(remoteMatrixLivekitMembers$.value).toSatisfy(
    (data: RemoteMatrixLivekitMember[]) => {
      expect(data.length).toEqual(1);
      expect(data[0].membership$.value).toBe(bobMembership);
      expect(data[0].participant.value$.value).toSatisfy((participant) => {
        expect(participant).toBeDefined();
        expect(participant!.identity).toEqual(bobParticipantId);
        return true;
      });
      expect(data[0].connection$.value).toBe(connection);
      return true;
    },
  );
});

test("should signal participant on a connection that is not publishing", async () => {
  const membershipsWithTransport$ = createMembershipsWithTransport$(
    constant([bobMembership]),
  );

  const connection = {
    transport: bobMembership.getTransport(bobMembership),
  } as unknown as Connection;
  const dataWithPublisher = new ConnectionManagerData();
  dataWithPublisher.add(connection, []);

  const connectionManagerData$ = constant(dataWithPublisher);

  const remoteMatrixLivekitMembers$ = createRemoteMatrixLivekitMembers$({
    scope: testScope,
    membershipsWithTransport$,
    connectionManager: {
      connectionManagerData$: connectionManagerData$,
    } as unknown as IConnectionManager,
    localUser: localRtcMember,
  });
  await flushPromises();
  expect(remoteMatrixLivekitMembers$.value).toSatisfy(
    (data: RemoteMatrixLivekitMember[]) => {
      expect(data.length).toEqual(1);
      expect(data[0].membership$.value).toBe(bobMembership);
      expect(data[0].participant.value$.value).toBe(null);
      expect(data[0].connection$.value).toBe(connection);
      return true;
    },
  );
});

describe("Publication edge case", () => {
  test("bob is publishing in several connections", async () => {
    const membershipsWithTransport$ = createMembershipsWithTransport$(
      constant([bobMembership, carlMembership]),
    );

    const connectionWithPublisher = new ConnectionManagerData();
    const bobParticipantId = fallbackMemberId(
      bobMembership.userId,
      bobMembership.deviceId,
    );
    const connectionA = {
      transport: transportA,
    } as unknown as Connection;
    const connectionB = {
      transport: transportB,
    } as unknown as Connection;

    connectionWithPublisher.add(connectionA, [
      mockRemoteParticipant({ identity: bobParticipantId }),
    ]);
    connectionWithPublisher.add(connectionB, [
      mockRemoteParticipant({ identity: bobParticipantId }),
    ]);

    const connectionManagerData$ = constant(connectionWithPublisher);

    const remoteMatrixLivekitMembers$ = createRemoteMatrixLivekitMembers$({
      scope: testScope,
      membershipsWithTransport$,
      connectionManager: {
        connectionManagerData$: connectionManagerData$,
      } as unknown as IConnectionManager,
      localUser: localRtcMember,
    });
    await flushPromises();
    expect(remoteMatrixLivekitMembers$.value).toSatisfy(
      (data: RemoteMatrixLivekitMember[]) => {
        expect(data.length).toEqual(2);
        expect(data[0].membership$.value).toBe(bobMembership);
        expect(data[0].connection$.value).toBe(connectionA);
        expect(data[0].participant.value$.value).toSatisfy((participant) => {
          expect(participant).toBeDefined();
          expect(participant!.identity).toEqual(bobParticipantId);
          return true;
        });

        return true;
      },
    );
  });
});

test("bob is publishing in the wrong connection", async () => {
  const mockedMemberships$ = state([bobMembership, carlMembership]);

  const membershipsWithTransport$ =
    createMembershipsWithTransport$(mockedMemberships$);

  const connectionWithPublisher = new ConnectionManagerData();

  const bobParticipantId = fallbackMemberId(
    bobMembership.userId,
    bobMembership.deviceId,
  );
  const connectionA = { transport: transportA } as unknown as Connection;
  const connectionB = { transport: transportB } as unknown as Connection;

  // Bob is not publishing on A
  connectionWithPublisher.add(connectionA, []);
  // Bob is publishing on B but his membership says A
  connectionWithPublisher.add(connectionB, [
    mockRemoteParticipant({ identity: bobParticipantId }),
  ]);

  const connectionsWithPublisher$ = state(connectionWithPublisher);
  const connectionManagerData$ = connectionsWithPublisher$;

  const remoteMatrixLivekitMembers$ = createRemoteMatrixLivekitMembers$({
    scope: testScope,
    membershipsWithTransport$,
    connectionManager: {
      connectionManagerData$: connectionManagerData$,
    } as unknown as IConnectionManager,
    localUser: localRtcMember,
  });

  await flushPromises();
  expect(remoteMatrixLivekitMembers$.value).toSatisfy(
    (data: RemoteMatrixLivekitMember[]) => {
      expect(data.length).toEqual(2);
      expect(data[0].membership$.value).toBe(bobMembership);
      expect(data[0].connection$.value).toBe(connectionA);
      expect(data[0].participant.value$.value).toBe(null);
      return true;
    },
  );
});
