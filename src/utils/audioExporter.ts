import type {
  AttachmentOpacityKeyframes,
  AudioTrack,
  Keyframes,
  SlotAttachmentKeyframes,
} from '../types';

type ExportAudioMixOptions = {
  audioTracks: AudioTrack[];
  keyframes: Keyframes;
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes;
  slotAttachmentKeyframes: SlotAttachmentKeyframes;
  duration: number;
  fps: number;
};

const SAMPLE_RATE = 48000;

const dataUrlToArrayBuffer = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return await response.arrayBuffer();
};

const getLastFrameFromRecord = <T,>(records: Record<string | number, Record<number, T>>) =>
  Object.values(records).reduce((maxFrame, framesByKey) => {
    const frames = Object.keys(framesByKey).map(Number);
    return frames.length > 0 ? Math.max(maxFrame, Math.max(...frames)) : maxFrame;
  }, -1);

const getExportTotalFrames = ({
  attachmentOpacityKeyframes,
  duration,
  keyframes,
  slotAttachmentKeyframes,
}: Omit<ExportAudioMixOptions, 'audioTracks' | 'fps'>) => {
  const lastKeyframe = Math.max(
    getLastFrameFromRecord(keyframes),
    getLastFrameFromRecord(attachmentOpacityKeyframes),
    getLastFrameFromRecord(slotAttachmentKeyframes),
  );

  return Math.max(1, lastKeyframe >= 0 ? lastKeyframe + 1 : duration);
};

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

const audioBufferToWav = (audioBuffer: AudioBuffer) => {
  const channelCount = audioBuffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  let offset = 0;

  writeString(view, offset, 'RIFF');
  offset += 4;
  view.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  writeString(view, offset, 'WAVE');
  offset += 4;
  writeString(view, offset, 'fmt ');
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, audioBuffer.sampleRate, true);
  offset += 4;
  view.setUint32(offset, audioBuffer.sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString(view, offset, 'data');
  offset += 4;
  view.setUint32(offset, dataLength, true);
  offset += 4;

  const channels = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );

  for (let sample = 0; sample < audioBuffer.length; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = Math.max(-1, Math.min(1, channels[channel][sample] ?? 0));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

export const exportAudioMix = async ({
  audioTracks,
  attachmentOpacityKeyframes,
  duration,
  fps,
  keyframes,
  slotAttachmentKeyframes,
}: ExportAudioMixOptions): Promise<Blob | null> => {
  const tracks = audioTracks.filter((track) => track.dataUrl);
  if (tracks.length === 0) return null;

  const totalFrames = getExportTotalFrames({
    attachmentOpacityKeyframes,
    duration,
    keyframes,
    slotAttachmentKeyframes,
  });
  const totalSeconds = totalFrames / fps;
  const frameCount = Math.max(1, Math.ceil(totalSeconds * SAMPLE_RATE));
  const context = new OfflineAudioContext(2, frameCount, SAMPLE_RATE);

  await Promise.all(
    tracks.map(async (track) => {
      const arrayBuffer = await dataUrlToArrayBuffer(track.dataUrl);
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      const source = context.createBufferSource();
      const gain = context.createGain();

      source.buffer = audioBuffer;
      gain.gain.value = Math.max(0, Math.min(1, track.volume));
      source.connect(gain);
      gain.connect(context.destination);
      source.start(Math.max(0, track.offsetFrames) / fps);
    }),
  );

  const renderedAudio = await context.startRendering();
  return audioBufferToWav(renderedAudio);
};
