import { useRef, useEffect, useState } from 'react';
import { Play, Pause, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';
import { drawTimeline } from '../../engine/timelineRenderer';

export const TimelinePanel = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { mode, selectedBoneId } = useEditorStore();
  const { bones, skins } = useSkeletonStore();
  const { captureSnapshot } = useHistoryStore();
  const {
    keyframes,
    frame,
    duration,
    fps,
    playing,
    setFrame,
    setDuration,
    setFps,
    play,
    stop,
    applyKeyframes,
    getKeyframesForBone,
  } = useAnimationStore();

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth, clientHeight } = wrapRef.current;
      canvasRef.current.width = clientWidth;
      canvasRef.current.height = clientHeight;
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawTimeline(ctx, bones, skins, keyframes, frame, duration, selectedBoneId, canvas.width, canvas.height);
  }, [bones, skins, keyframes, frame, duration, selectedBoneId]);

  useEffect(() => {
    if (!playing) return;

    const interval = 1000 / fps;
    const timer = setInterval(() => {
      setFrame((frame + 1) % (duration + 1));
      if (mode === 'animate') applyKeyframes();
    }, interval);

    return () => clearInterval(timer);
  }, [playing, frame, duration, fps, mode, setFrame, applyKeyframes]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const headerW = 120;
    const frameW = Math.max(8, (rect.width - headerW) / duration);

    if (sx > headerW) {
      setIsDragging(true);
      const newFrame = Math.round(Math.max(0, Math.min(duration, (sx - headerW) / frameW)));
      setFrame(newFrame);
      if (mode === 'animate') applyKeyframes();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const headerW = 120;
    const frameW = Math.max(8, (rect.width - headerW) / duration);
    const newFrame = Math.round(Math.max(0, Math.min(duration, (sx - headerW) / frameW)));
    setFrame(newFrame);
    if (mode === 'animate') applyKeyframes();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handlePrevKey = () => {
    if (selectedBoneId === null) return;
    const keys = getKeyframesForBone(selectedBoneId);
    const prev = keys.filter((k) => k < frame).pop();
    if (prev !== undefined) {
      setFrame(prev);
      applyKeyframes();
    }
  };

  const handleNextKey = () => {
    if (selectedBoneId === null) return;
    const keys = getKeyframesForBone(selectedBoneId);
    const next = keys.find((k) => k > frame);
    if (next !== undefined) {
      setFrame(next);
      applyKeyframes();
    }
  };

  const handleStop = () => {
    stop();
    setFrame(0);
    applyKeyframes();
  };

  return (
    <div className="h-[180px] flex-shrink-0 bg-panel border-t border-border flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-panel2">
        <button
          onClick={playing ? stop : play}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-xs"
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          onClick={handleStop}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-xs"
        >
          <Square size={12} />
        </button>
        <button
          onClick={handlePrevKey}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-xs"
        >
          <ChevronLeft size={12} />
        </button>
        <button
          onClick={handleNextKey}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-xs"
        >
          <ChevronRight size={12} />
        </button>
        <div className="text-[13px] font-bold text-accent2 min-w-[60px] text-center">
          {frame}
        </div>
        <span className="text-text-dim text-[10px]">/ {duration} frames</span>
        <div className="flex-1" />
        <span className="text-text-dim text-[10px]">FPS:</span>
        <input
          type="number"
          value={fps}
          onChange={(e) => {
            captureSnapshot();
            setFps(Math.max(1, Math.min(120, parseInt(e.target.value) || 24)));
          }}
          className="w-10 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
          min="1"
          max="120"
        />
        <span className="text-text-dim text-[10px]">Duration:</span>
        <input
          type="number"
          value={duration}
          onChange={(e) => {
            captureSnapshot();
            setDuration(Math.max(10, Math.min(300, parseInt(e.target.value) || 60)));
          }}
          className="w-12 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
          min="10"
          max="300"
        />
      </div>
      <div ref={wrapRef} className="flex-1 overflow-hidden relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="absolute top-0 left-0"
        />
      </div>
    </div>
  );
};
