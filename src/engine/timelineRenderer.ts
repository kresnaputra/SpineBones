import type { Bone, Skin, Keyframes } from '../types';

type AudioTrackRenderData = {
  enabled: boolean;
  name: string | null;
  offsetFrames: number;
  audioDurationFrames: number;
  waveformPeaks: number[];
};

export const drawTimeline = (
  ctx: CanvasRenderingContext2D,
  bones: Bone[],
  skins: Skin[],
  keyframes: Keyframes,
  selectedKeyframes: Array<{ boneId: number; frame: number }>,
  frame: number,
  duration: number,
  selectedBoneId: number | null,
  selectedBoneIds: number[],
  audioTrack: AudioTrackRenderData,
  width: number,
  height: number
): void => {
  const rowH = 28;
  const audioRowH = audioTrack.enabled ? 36 : 0;
  const headerW = 120;
  const frameW = Math.max(8, (width - headerW) / duration);
  const selectedKeyframeSet = new Set(
    selectedKeyframes.map((keyframe) => `${keyframe.boneId}:${keyframe.frame}`),
  );
  const selectedFrameSet = new Set(selectedKeyframes.map((keyframe) => keyframe.frame));

  ctx.fillStyle = '#13131a';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1a1a26';
  ctx.fillRect(headerW, 0, width - headerW, 20);

  for (let f = 0; f <= duration; f++) {
    const fx = headerW + f * frameW;
    const isMajor = f % 10 === 0;
    const isMed = f % 5 === 0;

    ctx.strokeStyle = isMajor
      ? 'rgba(255,255,255,0.3)'
      : isMed
      ? 'rgba(255,255,255,0.15)'
      : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx, isMajor ? 0 : isMed ? 6 : 12);
    ctx.lineTo(fx, 20);
    ctx.stroke();

    if (isMajor && fx < width) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px JetBrains Mono';
      ctx.fillText(String(f), fx + 2, 14);
    }
  }

  if (audioTrack.enabled) {
    const y = 20;
    const contentX = headerW;
    const contentW = width - headerW;
    const waveformY = y + 4;
    const waveformH = audioRowH - 8;
    const audioStartX = headerW + audioTrack.offsetFrames * frameW;
    const clampedDurationFrames = Math.max(0, Math.min(duration - audioTrack.offsetFrames, audioTrack.audioDurationFrames));
    const audioEndX = audioStartX + clampedDurationFrames * frameW;

    ctx.fillStyle = 'rgba(124,58,237,0.12)';
    ctx.fillRect(0, y, width, audioRowH);

    ctx.fillStyle = '#c4b5fd';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('Audio', 8, y + 14);

    ctx.fillStyle = '#7c3aed';
    ctx.font = '9px JetBrains Mono';
    ctx.fillText(audioTrack.name ?? 'Track', 8, y + 26);

    ctx.fillStyle = 'rgba(124,58,237,0.18)';
    ctx.fillRect(contentX, waveformY, contentW, waveformH);

    if (audioTrack.audioDurationFrames > 0 && audioTrack.waveformPeaks.length > 1) {
      const visibleStartFrame = Math.max(0, audioTrack.offsetFrames);
      const visibleEndFrame = Math.min(duration, audioTrack.offsetFrames + audioTrack.audioDurationFrames);

      if (visibleEndFrame > visibleStartFrame) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(contentX, waveformY, contentW, waveformH);
        ctx.clip();

        const centerY = waveformY + waveformH / 2;
        const amplitude = waveformH / 2 - 3;
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let sample = 0; sample < audioTrack.waveformPeaks.length; sample++) {
          const ratio = sample / (audioTrack.waveformPeaks.length - 1);
          const framePos = audioTrack.offsetFrames + ratio * audioTrack.audioDurationFrames;
          const x = headerW + framePos * frameW;
          const peak = Math.min(1, Math.max(0, audioTrack.waveformPeaks[sample] ?? 0));
          const yTop = centerY - peak * amplitude;
          const yBottom = centerY + peak * amplitude;

          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBottom);
        }

        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(audioStartX, y + 2);
    ctx.lineTo(audioStartX, y + audioRowH - 2);
    ctx.stroke();

    if (audioEndX > audioStartX) {
      ctx.fillStyle = 'rgba(124,58,237,0.1)';
      ctx.fillRect(audioStartX, waveformY, audioEndX - audioStartX, waveformH);
    }

    ctx.strokeStyle = 'rgba(42,42,61,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + audioRowH);
    ctx.lineTo(width, y + audioRowH);
    ctx.stroke();
  }

  bones.forEach((bone, i) => {
    const y = 20 + audioRowH + i * rowH;
    const skinCol = skins.find((s) => s.id === bone.skinId)?.color || '#7c3aed';
    const isSelected = selectedBoneIds.includes(bone.id) || selectedBoneId === bone.id;

    ctx.fillStyle =
      isSelected
        ? 'rgba(124,58,237,0.15)'
        : i % 2 === 0
        ? '#13131a'
        : '#111119';
    ctx.fillRect(0, y, width, rowH);

    ctx.fillStyle = isSelected ? '#a855f7' : '#94a3b8';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(bone.name, 8, y + rowH / 2 + 4);

    ctx.fillStyle = skinCol;
    ctx.fillRect(0, y, 3, rowH);

    if (keyframes[bone.id]) {
      Object.keys(keyframes[bone.id]).forEach((kf) => {
        const frameNumber = parseInt(kf);
        const fx = headerW + frameNumber * frameW;
        const isSelectedKeyframe = selectedKeyframeSet.has(`${bone.id}:${frameNumber}`);
        ctx.save();
        ctx.translate(fx, y + rowH / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = isSelectedKeyframe ? '#7c3aed' : '#f59e0b';
        ctx.fillRect(-5, -5, 10, 10);
        if (isSelectedKeyframe) {
          ctx.strokeStyle = '#f5f3ff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-5, -5, 10, 10);
        }
        ctx.restore();
      });
    }

    ctx.strokeStyle = 'rgba(42,42,61,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + rowH);
    ctx.lineTo(width, y + rowH);
    ctx.stroke();
  });

  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headerW, 0);
  ctx.lineTo(headerW, height);
  ctx.stroke();

  selectedFrameSet.forEach((selectedFrame) => {
    const selectedX = headerW + selectedFrame * frameW;
    ctx.strokeStyle = 'rgba(124,58,237,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(selectedX, 0);
    ctx.lineTo(selectedX, height);
    ctx.stroke();
  });

  const px = headerW + frame * frameW;
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(px - 1, 0, 2, height);

  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.moveTo(px - 6, 0);
  ctx.lineTo(px + 6, 0);
  ctx.lineTo(px, 10);
  ctx.closePath();
  ctx.fill();
};
