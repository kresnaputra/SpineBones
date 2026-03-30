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
  const [hoveredKeyframe, setHoveredKeyframe] = useState<{ boneId: number; frame: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; boneId: number; frame: number } | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const { mode, selectedBoneId, selectBone } = useEditorStore();
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
    deleteKeyframe,
  } = useAnimationStore();

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth } = wrapRef.current;
      const rowH = 28;
      const headerH = 20;
      const requiredHeight = headerH + bones.length * rowH;
      
      canvasRef.current.width = clientWidth;
      canvasRef.current.height = requiredHeight;
      setResizeTick((tick) => tick + 1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [bones.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawTimeline(ctx, bones, skins, keyframes, frame, duration, selectedBoneId, canvas.width, canvas.height);
  }, [bones, skins, keyframes, frame, duration, selectedBoneId, resizeTick]);

  useEffect(() => {
    if (!playing) return;

    const interval = 1000 / fps;
    const timer = setInterval(() => {
      // Find the highest keyframe across all bones
      let maxKeyframe = 0;
      Object.values(keyframes).forEach((boneKeyframes) => {
        const frames = Object.keys(boneKeyframes).map(Number);
        const maxFrame = Math.max(...frames);
        if (maxFrame > maxKeyframe) maxKeyframe = maxFrame;
      });

      // If we've reached or passed the last keyframe, loop back to 0
      if (frame >= maxKeyframe && maxKeyframe > 0) {
        setFrame(0);
      } else {
        setFrame(frame + 1);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [playing, frame, duration, fps, setFrame, keyframes]);

  useEffect(() => {
    if (playing && mode === 'animate') {
      applyKeyframes();
    }
  }, [frame, playing, mode, applyKeyframes]);

  const getKeyframeAtPosition = (sx: number, sy: number): { boneId: number; frame: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    
    const headerW = 120;
    const rowH = 28;
    const headerH = 20;
    const frameW = Math.max(8, (rect.width - headerW) / duration);
    
    if (sx < headerW) return null;
    
    const boneIndex = Math.floor((sy - headerH) / rowH);
    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    
    const bone = bones[boneIndex];
    const boneKeyframes = keyframes[bone.id];
    if (!boneKeyframes) return null;
    
    for (const kf of Object.keys(boneKeyframes)) {
      const kfFrame = parseInt(kf);
      const kfX = headerW + kfFrame * frameW;
      const kfY = headerH + boneIndex * rowH + rowH / 2;
      
      const dist = Math.hypot(sx - kfX, sy - kfY);
      if (dist < 8) {
        return { boneId: bone.id, frame: kfFrame };
      }
    }
    
    return null;
  };

  const getBoneAtPosition = (sy: number) => {
    const headerH = 20;
    const rowH = 28;
    const boneIndex = Math.floor((sy - headerH) / rowH);

    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    return bones[boneIndex] ?? null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    
    const keyframeHit = getKeyframeAtPosition(sx, sy);
    const boneHit = getBoneAtPosition(sy);

    if (boneHit) {
      selectBone(boneHit.id);
    } else if (sy <= 20) {
      selectBone(null);
    }
    
    if (e.detail === 2 && keyframeHit) {
      deleteKeyframe(keyframeHit.boneId, keyframeHit.frame);
      return;
    }
    
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
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    
    const keyframeHit = getKeyframeAtPosition(sx, sy);
    setHoveredKeyframe(keyframeHit);
    
    if (!isDragging) return;
    
    const headerW = 120;
    const frameW = Math.max(8, (rect.width - headerW) / duration);
    const newFrame = Math.round(Math.max(0, Math.min(duration, (sx - headerW) / frameW)));
    setFrame(newFrame);
    if (mode === 'animate') applyKeyframes();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    
    const keyframeHit = getKeyframeAtPosition(sx, sy);
    if (keyframeHit) {
      captureSnapshot();
      deleteKeyframe(keyframeHit.boneId, keyframeHit.frame);
    }
  };

  const handleDeleteFromContextMenu = () => {
    if (contextMenu) {
      deleteKeyframe(contextMenu.boneId, contextMenu.frame);
      setContextMenu(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && hoveredKeyframe) {
        deleteKeyframe(hoveredKeyframe.boneId, hoveredKeyframe.frame);
      }
    };

    const handleClickOutside = () => {
      setContextMenu(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [hoveredKeyframe, deleteKeyframe]);

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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-panel2 panel-padding-left">
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
      <div ref={wrapRef} className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-thin">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          className="block"
          style={{ cursor: hoveredKeyframe ? 'pointer' : 'default' }}
        />
        
        {contextMenu && (
          <div
            className="fixed bg-panel2 border border-border rounded-md shadow-lg py-1 z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleDeleteFromContextMenu}
              className="w-full px-4 py-1.5 text-left text-[11px] text-text hover:bg-accent hover:text-white transition-colors"
            >
              Delete Keyframe
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
