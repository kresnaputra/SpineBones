// Shared clamps for animation duration/fps, used by the RAG pipeline, synthesizer, and evaluation logger.
export const clampDuration = (duration: number): number => Math.max(10, Math.min(300, duration));
export const clampFps = (fps: number): number => Math.max(1, Math.min(120, fps));
