/*
Copyright 2023-2025 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type IWidgetApiRequest } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/lib/logger";

import { type MediaDevices, type MediaDevice } from "../state/MediaDevices";
import { ElementWidgetActions, widget } from "../widget";
import { type ObservableScope } from "./ObservableScope";
import { type Behavior, computed, constant, state } from "./Behavior";

export type Handler = (desired: boolean) => Promise<boolean>;
const defaultHandler: Handler = async (desired) => Promise.resolve(desired);

/**
 * Internal class - exported only for testing purposes.
 * Do not use directly outside of tests.
 */
export class MuteState<Label, Selected> {
  private handler = defaultHandler;

  public setHandler(handler: Handler): void {
    if (this.handler !== defaultHandler)
      throw new Error("Multiple mute state handlers are not supported");
    this.handler = handler;
  }

  public unsetHandler(): void {
    this.handler = defaultHandler;
  }

  private readonly canControlDevices$ = computed(
    () => !this.forceMute$.value && this.device.available$.value.size > 0,
  );

  private readonly _enabled$ = state(false);
  public readonly enabled$: Behavior<boolean> = this._enabled$;

  /**
   * Whether the handler is currently being asked to apply a change.
   */
  public readonly syncing$ = state(false);

  /**
   * The most recently requested state, which the handler is brought towards.
   */
  private desired = this.enabledByDefault;

  public readonly setEnabled$: Behavior<((enabled: boolean) => void) | null> =
    computed(() =>
      this.canControlDevices$.value
        ? (enabled: boolean): void => this.request(enabled)
        : null,
    );

  public readonly toggle$: Behavior<(() => void) | null> = computed(() =>
    this.canControlDevices$.value
      ? (): void => {
          if (!this.syncing$.value) this.request(!this._enabled$.value);
        }
      : null,
  );

  private request(desired: boolean): void {
    this.desired = desired;
    if (!this.syncing$.peek()) void this.sync();
  }

  // Asks the handler to move towards the desired state until it is reached or
  // the handler fails to make progress. Requests made in the meantime just
  // update the target.
  private async sync(): Promise<void> {
    this.syncing$.value = true;
    try {
      while (this._enabled$.peek() !== this.desired) {
        const enabled = await this.handler(this.desired);
        if (enabled === this._enabled$.peek()) break;
        this._enabled$.value = enabled;
      }
    } catch (err) {
      // TODO: better error handling
      logger.error("MuteState: handler error", err);
    } finally {
      this.syncing$.value = false;
    }
  }

  public constructor(
    scope: ObservableScope,
    private readonly device: MediaDevice<Label, Selected>,
    private readonly enabledByDefault: boolean,
    /**
     * A Behavior which, when true, forces the mute. Used for video to stop the
     * camera when earpiece mode is on.
     */
    private readonly forceMute$: Behavior<boolean>,
  ) {
    scope.effect(() => {
      const canControlDevices = this.canControlDevices$.value;
      logger.info(
        `MuteState: canControlDevices: ${canControlDevices}, enabled by default: ${enabledByDefault}`,
      );
      if (canControlDevices) {
        // Assume the default value only once devices are actually connected
        this.desired = enabledByDefault;
        this._enabled$.value = enabledByDefault;
      } else {
        // Sync the mute state with the handler to ensure nothing is published
        this.handler(false).catch((err) => {
          logger.error("MuteState-disable: handler error", err);
        });
        this.desired = false;
        this._enabled$.value = false;
      }
    });
  }
}

export class MuteStates {
  /**
   *  True if the selected audio output device is an earpiece.
   *  Used to force-disable video when on earpiece.
   */
  private readonly isEarpiece$ = computed(() => {
    const selected = this.mediaDevices.audioOutput.selected$.value;
    if (!selected?.id) return false;
    const device = this.mediaDevices.audioOutput.available$.value.get(
      selected.id,
    );
    logger.info(`MuteStates: selected audio output device:`, device);
    return device?.type === "earpiece";
  });

  public readonly audio = new MuteState(
    this.scope,
    this.mediaDevices.audioInput,
    this.initialMuteState.audioEnabled,
    constant(false),
  );
  public readonly video = new MuteState(
    this.scope,
    this.mediaDevices.videoInput,
    this.initialMuteState.videoEnabled,
    this.isEarpiece$,
  );

  public constructor(
    private readonly scope: ObservableScope,
    private readonly mediaDevices: MediaDevices,
    private readonly initialMuteState: {
      audioEnabled: boolean;
      videoEnabled: boolean;
    },
  ) {
    if (widget !== null) {
      // Sync our mute states with the hosting client
      const widgetApiState = (): {
        audio_enabled: boolean;
        video_enabled: boolean;
      } => ({
        audio_enabled: this.audio.enabled$.value,
        video_enabled: this.video.enabled$.value,
      });
      this.scope.effect(() => {
        widget!.api.transport
          .send(ElementWidgetActions.DeviceMute, widgetApiState())
          .catch((e) =>
            logger.warn("Could not send DeviceMute action to widget", e),
          );
      });

      // Also sync the hosting client's mute states back with ours
      const onDeviceMute = (ev: CustomEvent<IWidgetApiRequest>): void => {
        // First copy the current state into our new state
        const newState = widgetApiState();
        const setAudioEnabled = this.audio.setEnabled$.value;
        const setVideoEnabled = this.video.setEnabled$.value;
        // Update new state if there are any requested changes from the widget
        // action in `ev.detail.data`.
        if (
          typeof ev.detail.data.audio_enabled === "boolean" &&
          setAudioEnabled !== null
        ) {
          newState.audio_enabled = ev.detail.data.audio_enabled;
          setAudioEnabled(newState.audio_enabled);
        }
        if (
          typeof ev.detail.data.video_enabled === "boolean" &&
          setVideoEnabled !== null
        ) {
          newState.video_enabled = ev.detail.data.video_enabled;
          setVideoEnabled(newState.video_enabled);
        }
        widget!.api.transport.reply(ev.detail, newState);
      };
      widget.lazyActions.on(ElementWidgetActions.DeviceMute, onDeviceMute);
      this.scope.onEnd(() =>
        widget!.lazyActions.off(ElementWidgetActions.DeviceMute, onDeviceMute),
      );
    }
  }
}
