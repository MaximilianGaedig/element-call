/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ReactNode, useEffect, useState } from "react";

import { playReactionsSound, useSetting } from "../settings/settings";
import { GenericReaction, ReactionSet } from "../reactions";
import { useAudioContext } from "../useAudioContext";
import { prefetchSounds } from "../soundUtils";
import { useLatest } from "../useLatest";
import { type CallViewModel } from "../state/CallViewModel/CallViewModel";
import { useBehaviorChange } from "../useBehavior";

const soundMap = Object.fromEntries([
  ...ReactionSet.filter((v) => v.sound !== undefined).map((v) => [
    v.name,
    v.sound!,
  ]),
  [GenericReaction.name, GenericReaction.sound],
]);

export function ReactionsAudioRenderer({
  vm,
  muted,
}: {
  vm: CallViewModel;
  muted?: boolean;
}): ReactNode {
  const [shouldPlay] = useSetting(playReactionsSound);
  const [soundCache, setSoundCache] = useState<ReturnType<
    typeof prefetchSounds
  > | null>(null);
  const audioEngineCtx = useAudioContext({
    sounds: soundCache,
    latencyHint: "interactive",
    muted,
  });
  const audioEngineRef = useLatest(audioEngineCtx);

  useEffect(() => {
    if (!shouldPlay || soundCache) {
      return;
    }
    // This is fine even if we load the component multiple times,
    // as the browser's cache should ensure once the media is loaded
    // once that future fetches come via the cache.
    setSoundCache(prefetchSounds(soundMap));
  }, [soundCache, shouldPlay]);

  // Play each reaction as it appears (once per distinct reaction, even if
  // several people react at the same time)
  useBehaviorChange(vm.reactions$, (reactions, previous) => {
    if (!shouldPlay) return;
    const alreadyPlaying = new Set(Object.values(previous).map((r) => r.name));
    for (const name of new Set(Object.values(reactions).map((r) => r.name))) {
      if (alreadyPlaying.has(name)) continue;
      // Fall back to a generic sound for reactions without their own
      void audioEngineRef.current?.playSound(soundMap[name] ? name : "generic");
    }
  });
  return null;
}
