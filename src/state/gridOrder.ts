/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// The order in which people appear in the grid, or in the stack of thumbnails
// next to a spotlight. The aim is to never reshuffle: someone only moves when
// they need to be brought on screen (swapping with whoever on screen has been
// quiet the longest), when the spotlight changes, or when people join or leave.

export interface OrderedMember<M> {
  media: M;
  /** Pinned members keep their end of the list and are never displaced. */
  pin?: "first" | "last";
  presenting: boolean;
  handRaised: boolean;
  /** Speaking right now (after the usual activation delay). */
  speaking: boolean;
  video: boolean;
  /** When this member last spoke, or joined; decides who gets displaced. */
  lastActive: number;
}

export interface OrderInputs<M> {
  /** The members to show in the list, in the order they joined. */
  members: readonly OrderedMember<M>[];
  /** How many list entries fit on screen. */
  visibleTiles: number;
  /**
   * The member now in the spotlight, if any. Callers pass this every time;
   * it only matters when `leaving` is a member of the list who wasn't before.
   */
  entering?: M;
  /**
   * The member who was in the spotlight last time, if any. If they've come
   * back to the list, they take `entering`'s old slot so nothing else shifts.
   */
  leaving?: M;
}

/**
 * How badly a member needs to be on screen. Presenters trump raised hands,
 * which trump speakers, which trump people with video. Nobody else is ever
 * pulled on screen, and nobody is displaced by someone with an equal or lesser
 * need.
 */
function need<M>(m: OrderedMember<M>): number {
  if (m.presenting) return 4;
  if (m.handRaised) return 3;
  if (m.speaking) return 2;
  if (m.video) return 1;
  return 0;
}

/**
 * Moves `media` to where `to` currently sits, shifting whatever lies between.
 * This is how the user rearranges the list by hand; the result becomes the
 * starting point for reconcileOrder like any other previous order.
 */
export function moveMember<M>(order: readonly M[], media: M, to: M): M[] {
  const from = order.indexOf(media);
  const dest = order.indexOf(to);
  if (from === -1 || dest === -1 || from === dest) return order as M[];
  const next = order.filter((m) => m !== media);
  next.splice(dest, 0, media);
  return next;
}

/**
 * Updates the previous order for the current members.
 */
export function reconcileOrder<M>(
  prev: readonly M[],
  { members, visibleTiles, entering, leaving }: OrderInputs<M>,
): M[] {
  const byMedia = new Map(members.map((m) => [m.media, m]));
  // The person leaving the spotlight takes the slot of the person entering it,
  // so that the list doesn't shift
  const swapped =
    leaving !== undefined && byMedia.has(leaving) && !prev.includes(leaving)
      ? prev.map((m) => (m === entering ? leaving : m))
      : prev;
  const kept = swapped.filter((m) => byMedia.has(m));
  const first = kept.filter((m) => byMedia.get(m)!.pin === "first");
  const last = kept.filter((m) => byMedia.get(m)!.pin === "last");
  const list = kept.filter((m) => byMedia.get(m)!.pin === undefined);
  const info = (m: M): OrderedMember<M> => byMedia.get(m)!;

  // Joiners: video-on after the first run of video-on members, others at the
  // end
  const present = new Set(kept);
  for (const m of members) {
    if (present.has(m.media)) continue;
    present.add(m.media);
    if (m.pin === "first") first.push(m.media);
    else if (m.pin === "last") last.push(m.media);
    else if (!m.video) list.push(m.media);
    else {
      let i = list.findIndex((o) => info(o).video);
      if (i === -1) i = 0;
      else while (i < list.length && info(list[i]).video) i++;
      list.splice(i, 0, m.media);
    }
  }

  // Bring people who need to be on screen on screen, the neediest first
  const visible = visibleTiles - first.length;
  const needy = list
    .filter((m) => need(info(m)) > 0)
    .sort(
      (a, b) =>
        need(info(b)) - need(info(a)) ||
        info(b).lastActive - info(a).lastActive,
    );
  for (const m of needy) {
    const i = list.indexOf(m);
    if (i < visible) continue;
    let victim = -1;
    for (let j = 0; j < Math.min(visible, list.length); j++) {
      if (need(info(list[j])) >= need(info(m))) continue;
      if (
        victim === -1 ||
        need(info(list[j])) < need(info(list[victim])) ||
        (need(info(list[j])) === need(info(list[victim])) &&
          info(list[j]).lastActive < info(list[victim]).lastActive)
      )
        victim = j;
    }
    if (victim !== -1) [list[i], list[victim]] = [list[victim], list[i]];
  }

  const next = [...first, ...list, ...last];
  return next.length === prev.length && next.every((m, i) => m === prev[i])
    ? (prev as M[])
    : next;
}
