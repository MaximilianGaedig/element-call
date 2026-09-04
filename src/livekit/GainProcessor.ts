/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type AudioProcessorOptions,
  type Track,
  type TrackProcessor,
} from "livekit-client";

/**
 * A LiveKit audio track processor that scales the microphone's volume before
 * it's published, so that users can turn themselves up or down without
 * touching their system settings.
 */
export class GainProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  public readonly name = "gain";
  public processedTrack?: MediaStreamTrack;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;

  public constructor(private value: number) {}

  public async init({
    track,
    audioContext,
  }: AudioProcessorOptions): Promise<void> {
    this.source = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    this.gain = audioContext.createGain();
    this.gain.gain.value = this.value;
    this.destination = audioContext.createMediaStreamDestination();
    this.source.connect(this.gain).connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
    return Promise.resolve();
  }

  public async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  public async destroy(): Promise<void> {
    this.source?.disconnect();
    this.gain?.disconnect();
    this.source = this.gain = this.destination = null;
    this.processedTrack = undefined;
    return Promise.resolve();
  }

  /** Sets the multiplier: 1 leaves the volume alone. */
  public setGain(value: number): void {
    this.value = value;
    // A short ramp avoids clicks
    this.gain?.gain.setTargetAtTime(value, 0, 0.05);
  }
}
