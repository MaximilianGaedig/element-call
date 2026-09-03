/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type RoomMember, RoomStateEvent } from "matrix-js-sdk";
import { type CallMembership } from "matrix-js-sdk/lib/matrixrtc";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";
import {
  KnownMembership,
  type Room as MatrixRoom,
} from "matrix-js-sdk/lib/matrix";

import { type ObservableScope } from "../../ObservableScope";
import {
  calculateDisplayName,
  shouldDisambiguate,
} from "../../../utils/displayname";
import { type Behavior, computed, fromEvents } from "../../Behavior";

export type RoomMemberMap = Map<
  string,
  Pick<RoomMember, "userId" | "getMxcAvatarUrl" | "rawDisplayName">
>;
export function roomToMembersMap(matrixRoom: MatrixRoom): RoomMemberMap {
  const members = matrixRoom
    .getMembersWithMembership(KnownMembership.Join)
    .concat(matrixRoom.getMembersWithMembership(KnownMembership.Invite));
  return members.reduce((acc, member) => {
    acc.set(member.userId, {
      userId: member.userId,
      getMxcAvatarUrl: member.getMxcAvatarUrl.bind(member),
      rawDisplayName: member.rawDisplayName,
    });
    return acc;
  }, new Map());
}

export function createRoomMembers$(
  scope: ObservableScope,
  matrixRoom: MatrixRoom,
): Behavior<RoomMemberMap> {
  return fromEvents(scope, matrixRoom, [RoomStateEvent.Members], (room) =>
    roomToMembersMap(room),
  );
}

/**
 * Displayname for each member of the call. This will disambiguate
 * any displayname that clashes with another member. Only members
 * joined to the call are considered here.
 *
 * @returns Map<userId, displayname> uses the Matrix user ID as the key.
 */
export const memberDisplaynames$ = (
  memberships$: Behavior<Pick<CallMembership, "userId">[]>,
  roomMembers$: Behavior<RoomMemberMap>,
): Behavior<Map<string, string>> => {
  const logger = rootLogger.getChild("[MatrixMemberMetadata]");
  // Users that at some point needed disambiguation stay disambiguated, so that
  // names don't flip back and forth as people come and go. This grows with the
  // number of members that have ever been in the call.
  const everDisambiguated = new Set<string>();
  return computed(() => {
    const memberships = memberships$.value;
    const roomMembers = roomMembers$.value;
    const displaynameMap = new Map<string, string>();
    // We only consider RTC members for disambiguation as they are the only visible members.
    for (const rtcMember of memberships) {
      const member = roomMembers.get(rtcMember.userId);
      if (!member) {
        logger.error(`Could not find member for user ${rtcMember.userId}`);
        continue;
      }
      const disambiguate =
        everDisambiguated.has(rtcMember.userId) ||
        shouldDisambiguate(member, memberships, roomMembers);
      if (disambiguate) everDisambiguated.add(rtcMember.userId);
      displaynameMap.set(
        rtcMember.userId,
        calculateDisplayName(member, disambiguate),
      );
    }
    return displaynameMap;
  });
};

export const createMatrixMemberMetadata$ = (
  memberships$: Behavior<Pick<CallMembership, "userId">[]>,
  roomMembers$: Behavior<RoomMemberMap>,
): {
  displayName$: (userId: string) => Behavior<string | undefined>;
  avatarUrl$: (userId: string) => Behavior<string | undefined>;
  displaynameMap$: Behavior<Map<string, string>>;
  avatarMap$: Behavior<Map<string, string | undefined>>;
} => {
  const displaynameMap$ = memberDisplaynames$(memberships$, roomMembers$);
  const avatarMap$ = computed(
    () =>
      new Map(
        [...roomMembers$.value].map(([userId, member]) => [
          userId,
          member.getMxcAvatarUrl(),
        ]),
      ),
  );
  return {
    displayName$: (userId) => computed(() => displaynameMap$.value.get(userId)),
    avatarUrl$: (userId) =>
      computed(() => roomMembers$.value.get(userId)?.getMxcAvatarUrl()),
    // mostly for testing purposes
    displaynameMap$,
    avatarMap$,
  };
};
