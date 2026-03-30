import type { Bone, Skin, Keyframes } from '../types';

export const drawTimeline = (
  ctx: CanvasRenderingContext2D,
  bones: Bone[],
  skins: Skin[],
  keyframes: Keyframes,
  frame: number,
  duration: number,
  selectedBoneId: number | null,
  width: number,
  height: number
): void => {
  const rowH = 28;
  const headerW = 120;
  const frameW = Math.max(8, (width - headerW) / duration);

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

  bones.forEach((bone, i) => {
    const y = 20 + i * rowH;
    const skinCol = skins.find((s) => s.id === bone.skinId)?.color || '#7c3aed';

    ctx.fillStyle =
      selectedBoneId === bone.id
        ? 'rgba(124,58,237,0.15)'
        : i % 2 === 0
        ? '#13131a'
        : '#111119';
    ctx.fillRect(0, y, width, rowH);

    ctx.fillStyle = selectedBoneId === bone.id ? '#a855f7' : '#94a3b8';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(bone.name, 8, y + rowH / 2 + 4);

    ctx.fillStyle = skinCol;
    ctx.fillRect(0, y, 3, rowH);

    if (keyframes[bone.id]) {
      Object.keys(keyframes[bone.id]).forEach((kf) => {
        const fx = headerW + parseInt(kf) * frameW;
        ctx.save();
        ctx.translate(fx, y + rowH / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-4, -4, 8, 8);
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
