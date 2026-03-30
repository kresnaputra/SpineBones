import type { Point } from '../types';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const distance = (p1: Point, p2: Point): number => {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
};

export const distanceToSegment = (
  point: Point,
  segStart: Point,
  segEnd: Point
): number => {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const len = Math.hypot(dx, dy);
  
  if (len < 1) return distance(point, segStart);
  
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / (len * len)
    )
  );
  
  const closest = {
    x: segStart.x + t * dx,
    y: segStart.y + t * dy,
  };
  
  return distance(point, closest);
};

export const angleBetween = (p1: Point, p2: Point): number => {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
};
