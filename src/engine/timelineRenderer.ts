import type { Bone, Skin, KeyframeEasing, Keyframes } from '../types';
import { normalizeKeyframeEasing } from '../utils/easing';

type AudioTrackRenderData = {
  enabled: boolean;
  name: string | null;
  offsetFrames: number;
  audioDurationFrames: number;
  waveformPeaks: number[];
};

type TimelineSelection = {
  kind: 'bone' | 'sprite';
  boneId: number;
  frame: number;
  slotId?: number;
};

type SpriteSwapMarker = {
  slotId: number;
  frame: number;
  attachmentName: string | null;
};

export const drawTimelineHeader = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  duration: number,
  width: number,
  height: number,
  scrollOffsetX: number = 0,
  frameW?: number,
): void => {
  const headerW = 120;
  const paddingRight = 50;
  const computedFrameW = frameW ?? Math.max(8, (width - headerW - paddingRight) / duration);
  const frameToX = (f: number) => headerW + f * computedFrameW - scrollOffsetX;

  ctx.fillStyle = '#13131a';
  ctx.fillRect(0, 0, headerW, height);
  ctx.fillStyle = '#1a1a26';
  ctx.fillRect(headerW, 0, width - headerW, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(headerW, 0, width - headerW, height);
  ctx.clip();

  for (let f = 0; f <= duration; f++) {
    const fx = frameToX(f);
    if (fx < headerW || fx > width) continue;
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
    ctx.lineTo(fx, height);
    ctx.stroke();

    if (isMajor) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px JetBrains Mono';
      ctx.fillText(String(f), fx + 2, 14);
    }
  }

  // Playhead marker on header
  const px = frameToX(frame);
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(px - 1, 0, 2, height);
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.moveTo(px - 6, 0);
  ctx.lineTo(px + 6, 0);
  ctx.lineTo(px, 10);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headerW, 0);
  ctx.lineTo(headerW, height);
  ctx.stroke();
};

export const drawTimeline = (
  ctx: CanvasRenderingContext2D,
  bones: Bone[],
  skins: Skin[],
  keyframes: Keyframes,
  spriteSwapMarkersByBone: Record<number, SpriteSwapMarker[]>,
  selectedKeyframes: TimelineSelection[],
  frame: number,
  duration: number,
  selectedBoneId: number | null,
  selectedBoneIds: number[],
  audioTrack: AudioTrackRenderData,
  width: number,
  height: number,
  scrollOffsetX: number = 0,
  frameW?: number,
): void => {
  const easingColors: Record<KeyframeEasing, string> = {
    linear: '#f59e0b',
    easeIn: '#60a5fa',
    easeOut: '#34d399',
    easeInOut: '#f472b6',
  };
  const rowH = 28;
  const audioRowH = audioTrack.enabled ? 36 : 0;
  const headerW = 120;
  const paddingRight = 50;
  const computedFrameW = frameW ?? Math.max(8, (width - headerW - paddingRight) / duration);
  const selectedBoneKeyframeSet = new Set(
    selectedKeyframes
      .filter((keyframe) => keyframe.kind === 'bone')
      .map((keyframe) => `${keyframe.boneId}:${keyframe.frame}`),
  );
  const selectedSpriteKeyframeSet = new Set(
    selectedKeyframes
      .filter((keyframe) => keyframe.kind === 'sprite' && typeof keyframe.slotId === 'number')
      .map((keyframe) => `${keyframe.slotId}:${keyframe.frame}`),
  );
  const selectedFrameSet = new Set(selectedKeyframes.map((keyframe) => keyframe.frame));

  // Helper: convert a frame number to screen X, accounting for scroll
  const frameToX = (f: number) => headerW + f * computedFrameW - scrollOffsetX;

  ctx.fillStyle = '#13131a';
  ctx.fillRect(0, 0, width, height);

  // Clip frame area so content never bleeds over the bone-name column
  ctx.save();
  ctx.beginPath();
  ctx.rect(headerW, 0, width - headerW, height);
  ctx.clip();

  if (audioTrack.enabled) {
    const y = 0;
    const contentX = headerW;
    const contentW = width - headerW;
    const waveformY = y + 4;
    const waveformH = audioRowH - 8;
    const audioStartX = frameToX(audioTrack.offsetFrames);
    const clampedDurationFrames = Math.max(0, Math.min(duration - audioTrack.offsetFrames, audioTrack.audioDurationFrames));
    const audioEndX = audioStartX + clampedDurationFrames * computedFrameW;

    ctx.fillStyle = 'rgba(124,58,237,0.12)';
    ctx.fillRect(0, y, width, audioRowH);
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
          const x = frameToX(framePos);
          const peak = Math.min(1, Math.max(0, audioTrack.waveformPeaks[sample] ?? 0));
          ctx.moveTo(x, centerY - peak * amplitude);
          ctx.lineTo(x, centerY + peak * amplitude);
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

  // Keyframes
  bones.forEach((bone, i) => {
    const y = audioRowH + i * rowH;
    const spriteTrackTop = y + rowH - 12;
    const spriteTrackY = spriteTrackTop + 4;

    if ((spriteSwapMarkersByBone[bone.id] ?? []).length > 0) {
      ctx.fillStyle = 'rgba(34,211,238,0.08)';
      ctx.fillRect(headerW, spriteTrackTop - 3, width - headerW, 8);
    }

    ctx.strokeStyle = 'rgba(34,211,238,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(headerW, spriteTrackY);
    ctx.lineTo(width, spriteTrackY);
    ctx.stroke();

    if (keyframes[bone.id]) {
      Object.keys(keyframes[bone.id]).forEach((kf) => {
        const frameNumber = parseInt(kf);
        const fx = frameToX(frameNumber);
        if (fx < headerW - 8 || fx > width + 8) return;
        const isSelectedKeyframe = selectedBoneKeyframeSet.has(`${bone.id}:${frameNumber}`);
        const easing = normalizeKeyframeEasing(keyframes[bone.id][frameNumber]?.easing);
        ctx.save();
        ctx.translate(fx, y + rowH / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = isSelectedKeyframe ? '#7c3aed' : easingColors[easing];
        ctx.fillRect(-5, -5, 10, 10);
        if (isSelectedKeyframe) {
          ctx.strokeStyle = '#f5f3ff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-5, -5, 10, 10);
        }
        ctx.restore();
      });
    }

    const spriteFrames = spriteSwapMarkersByBone[bone.id] ?? [];
    spriteFrames.forEach((marker) => {
      const fx = frameToX(marker.frame);
      if (fx < headerW - 8 || fx > width + 8) return;
      const isSelectedSpriteKeyframe = selectedSpriteKeyframeSet.has(
        `${marker.slotId}:${marker.frame}`,
      );
      ctx.save();
      ctx.fillStyle = isSelectedSpriteKeyframe ? '#0891b2' : '#22d3ee';
      ctx.strokeStyle = isSelectedSpriteKeyframe ? '#ecfeff' : '#a5f3fc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(fx - 7, spriteTrackY - 4, 14, 8, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  });

  // Selected frame highlight columns
  selectedFrameSet.forEach((selectedFrame) => {
    const selectedX = frameToX(selectedFrame);
    ctx.strokeStyle = 'rgba(124,58,237,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(selectedX, 0);
    ctx.lineTo(selectedX, height);
    ctx.stroke();
  });

  // Playhead line
  const px = frameToX(frame);
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(px - 1, 0, 2, height);

  ctx.restore(); // end frame area clip

  // Bone name rows (left column, no clip needed)
  bones.forEach((bone, i) => {
    const y = audioRowH + i * rowH;
    const skinCol = skins.find((s) => s.id === bone.skinId)?.color || '#7c3aed';
    const isSelected = selectedBoneIds.includes(bone.id) || selectedBoneId === bone.id;
    const spriteMarkerCount = (spriteSwapMarkersByBone[bone.id] ?? []).length;

    ctx.fillStyle = isSelected ? 'rgba(124,58,237,0.15)' : i % 2 === 0 ? '#13131a' : '#111119';
    ctx.fillRect(0, y, headerW, rowH);
    ctx.fillStyle = isSelected ? '#a855f7' : '#94a3b8';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(bone.name, 8, y + rowH / 2 + 4);
    if (spriteMarkerCount > 0) {
      const badgeW = 34;
      const badgeH = 10;
      const badgeX = headerW - badgeW - 6;
      const badgeY = y + rowH - badgeH - 4;
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeStyle = 'rgba(34,211,238,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1);
      ctx.fillStyle = 'rgba(34,211,238,0.95)';
      ctx.font = '8px JetBrains Mono';
      ctx.fillText(`SPR ${spriteMarkerCount}`, badgeX + 4, badgeY + 7);
    }
    ctx.fillStyle = skinCol;
    ctx.fillRect(0, y, 3, rowH);
    ctx.strokeStyle = 'rgba(42,42,61,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + rowH);
    ctx.lineTo(width, y + rowH);
    ctx.stroke();
  });

  // Audio label (left column)
  if (audioTrack.enabled) {
    ctx.fillStyle = '#c4b5fd';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('Audio', 8, 14);
    ctx.fillStyle = '#7c3aed';
    ctx.font = '9px JetBrains Mono';
    ctx.fillText(audioTrack.name ?? 'Track', 8, 26);
  }

  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headerW, 0);
  ctx.lineTo(headerW, height);
  ctx.stroke();
};
