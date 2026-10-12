// Repackages downloaded streams into one MP4 with Mediabunny. Nothing is
// decoded or re-encoded: the encoded packets are copied from the inputs into
// the output, with their timestamps repaired on the way.
//
// It only needs Blobs and a WritableStream, so it runs outside the browser too.

import {
  ALL_FORMATS,
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type InputTrack,
  type StreamTargetChunk,
} from "mediabunny";
import { createRetimer, startOffsets, type Retimer } from "../media/timestamps.ts";

export interface MuxOptions {
  signal: AbortSignal;
  /** Called with a fraction from 0 to 1. */
  onProgress: (fraction: number) => void;
}

interface PacketSource {
  add(packet: Parameters<EncodedVideoPacketSource["add"]>[0], meta?: { decoderConfig?: unknown }): Promise<void>;
  close(): void;
}

async function copyPackets(track: InputTrack, source: PacketSource, retime: Retimer, signal: AbortSignal, onTime?: (seconds: number) => void): Promise<void> {
  const decoderConfig = track.isVideoTrack() ? await track.getDecoderConfig() : track.isAudioTrack() ? await track.getDecoderConfig() : null;
  let first = true;
  for await (const packet of new EncodedPacketSink(track).packets()) {
    signal.throwIfAborted();
    const timestamp = retime(packet.timestamp, packet.duration, packet.type === "key");
    // The muxer needs the decoder configuration with the first packet. Awaiting
    // add() lets it hold this track back until the other one has caught up.
    await source.add(packet.clone({ timestamp }), first && decoderConfig ? { decoderConfig } : undefined);
    first = false;
    onTime?.(timestamp);
  }
  source.close();
}

/**
 * Writes one MP4 to `writable`. The video comes from the first source. The
 * audio comes from the second source when there is one, otherwise from the
 * first.
 */
export async function muxToMp4(sources: readonly Blob[], writable: WritableStream<StreamTargetChunk>, options: MuxOptions): Promise<void> {
  const inputs = sources.map((blob) => new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) }));
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true }) });
  try {
    const video = await inputs[0]!.getPrimaryVideoTrack();
    if (!video) throw new Error("The stream has no video Sakti can read");
    const audio = (await inputs[1]?.getPrimaryAudioTrack()) ?? (await inputs[0]!.getPrimaryAudioTrack());

    const videoCodec = await video.getCodec();
    if (!videoCodec || !output.format.getSupportedVideoCodecs().includes(videoCodec)) {
      throw new Error("The video uses a codec that an MP4 file cannot hold");
    }
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource, { rotation: await video.getRotation() });

    let audioSource: EncodedAudioPacketSource | null = null;
    if (audio) {
      const audioCodec = await audio.getCodec();
      if (!audioCodec || !output.format.getSupportedAudioCodecs().includes(audioCodec)) {
        throw new Error("The audio uses a codec that an MP4 file cannot hold");
      }
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
    }

    const tracks = audio ? [video, audio] : [video];
    const offsets = startOffsets(await Promise.all(tracks.map((track) => track.getFirstTimestamp())));
    const duration = (await video.computeDuration()) - offsets[0]!;

    await output.start();
    const copies = [copyPackets(video, videoSource, createRetimer(offsets[0]!), options.signal, (seconds) => options.onProgress(duration > 0 ? Math.min(1, seconds / duration) : 0))];
    if (audio && audioSource) copies.push(copyPackets(audio, audioSource, createRetimer(offsets[1]!), options.signal));
    await Promise.all(copies);
    await output.finalize();
  } catch (error) {
    if (output.state === "started") await output.cancel().catch(() => {});
    else await writable.abort().catch(() => {});
    throw error;
  } finally {
    for (const input of inputs) input.dispose();
  }
}
