import type { Bone, Skin, Tool } from '../types';

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

export const drawBoneRelation = (
  ctx: CanvasRenderingContext2D,
  parent: Bone,
  child: Bone,
  isHighlighted: boolean,
  worldToScreen: (x: number, y: number) => { x: number; y: number }
): void => {
  const from = worldToScreen(parent._wx, parent._wy);
  const to = worldToScreen(child._wx, child._wy);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);

  if (distance < 4) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.setLineDash(isHighlighted ? [5, 4] : [4, 5]);
  ctx.strokeStyle = isHighlighted ? 'rgba(124,58,237,0.8)' : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = isHighlighted ? 2 : 1.25;
  ctx.stroke();
  ctx.setLineDash([]);
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
  worldToScreen: (x: number, y: number) => { x: number; y: number }
): void => {
  const color = skin?.color || '#f59e0b';
  const s = worldToScreen(bone._wx, bone._wy);

  ctx.fillStyle = isSelected
    ? '#7c3aed'
    : isHovered
    ? '#06b6d4'
    : color;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(s.x, s.y, isSelected ? 8 : 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.strokeStyle = isSelected
    ? '#7c3aed'
    : isHovered
    ? '#06b6d4'
    : color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, isSelected ? 8 : 6, 0, Math.PI * 2);
  ctx.stroke();

  if (hasKeyframe) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelected || isHovered) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(bone.name, s.x + 10, s.y - 10);
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
