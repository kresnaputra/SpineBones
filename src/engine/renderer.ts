import type { Bone, Skin, Tool } from '../types';
import { getBoneTip } from './transforms';

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  camZoom: number,
  width: number,
  height: number
): void => {
  const step = 40 * camZoom;
  const ox = (width / 2 - camX * camZoom) % step;
  const oy = (height / 2 - camY * camZoom) % step;

  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;

  for (let x = ox; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = oy; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
};

export const drawOriginCross = (
  ctx: CanvasRenderingContext2D,
  worldToScreen: (wx: number, wy: number) => { x: number; y: number }
): void => {
  const o = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  
  ctx.beginPath();
  ctx.moveTo(o.x - 20, o.y);
  ctx.lineTo(o.x + 20, o.y);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - 20);
  ctx.lineTo(o.x, o.y + 20);
  ctx.stroke();
};

export const drawBoneSegment = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  filled: boolean
): void => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  
  if (len < 2) return;

  const angle = Math.atan2(dy, dx);
  const w = Math.min(14, len * 0.18);

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, -w * 0.4);
  ctx.lineTo(len, 0);
  ctx.lineTo(w, w * 0.4);
  ctx.closePath();

  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
};

export const drawBone = (
  ctx: CanvasRenderingContext2D,
  bone: Bone,
  skin: Skin | undefined,
  isSelected: boolean,
  isHovered: boolean,
  tool: Tool,
  mode: string,
  hasKeyframe: boolean,
  worldToScreen: (wx: number, wy: number) => { x: number; y: number },
  camZoom: number
): void => {
  const skinColor = skin?.color || '#7c3aed';
  let color = skinColor;

  if (isSelected) color = '#a855f7';
  else if (isHovered) color = '#06b6d4';

  const s = worldToScreen(bone._wx, bone._wy);
  const tip = getBoneTip(bone);
  const e = worldToScreen(tip.x, tip.y);

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = isSelected ? 18 : 6;

  drawBoneSegment(ctx, s.x, s.y, e.x, e.y, color + '33', true);
  drawBoneSegment(ctx, s.x, s.y, e.x, e.y, color, false);

  ctx.restore();

  ctx.beginPath();
  ctx.arc(s.x, s.y, isSelected ? 6 : 4.5, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#fff' : color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color + '88';
  ctx.fill();

  if (camZoom > 0.5) {
    ctx.fillStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.max(9, 10 * camZoom)}px JetBrains Mono`;
    ctx.fillText(bone.name, s.x + 8, s.y - 8);
  }

  if (tool === 'rotate' && isSelected) {
    const r = (bone._wrot * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 28, r - 0.5, r + 0.5);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (mode === 'animate' && hasKeyframe) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, Math.PI / 4, Math.PI * 2 + Math.PI / 4);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
};
