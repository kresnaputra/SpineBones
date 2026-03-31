import { useRef, useEffect, useState } from 'react';
import { Play, Pause, Square, ChevronLeft, ChevronRight, Music2, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';
import { drawTimeline } from '../../engine/timelineRenderer';
import { openAudioFile } from '../../utils/nativeIO';

const HEADER_H = 20;
const ROW_H = 28;
const AUDIO_ROW_H = 36;
const HEADER_W = 120;
const MAX_WAVEFORM_SAMPLES = 240;

const AUDIO_FILTERS = [
  {
    name: 'Audio',
    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'],
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const dataUrlToArrayBuffer = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return await response.arrayBuffer();
};

const getAudioTimelineTime = (frame: number, fps: number, audioOffsetFrames: number) =>
  frame / fps - audioOffsetFrames / fps;

const isAudioTimelineActive = (timelineTime: number, audioDurationSeconds: number) =>
  timelineTime >= 0 && timelineTime < audioDurationSeconds;

const extractWaveformPeaks = (channelData: Float32Array, samples: number) => {
  if (channelData.length === 0 || samples <= 0) {
    return [];
  }

  const blockSize = Math.max(1, Math.floor(channelData.length / samples));
  const peaks: number[] = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const start = sample * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let peak = 0;

    for (let i = start; i < end; i += 1) {
      peak = Math.max(peak, Math.abs(channelData[i] ?? 0));
    }

    peaks.push(peak);
  }

  const highestPeak = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => peak / highestPeak);
};

export const TimelinePanel = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wasPlayingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'playhead' | 'audio-offset' | null>(null);
  const [hoveredKeyframe, setHoveredKeyframe] = useState<{ boneId: number; frame: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; boneId: number; frame: number } | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);

  const { mode, selectedBoneId, selectedBoneIds, selectBone } = useEditorStore();
  const { bones, skins } = useSkeletonStore();
  const { captureSnapshot } = useHistoryStore();
  const {
    keyframes,
    frame,
    duration,
    fps,
    playing,
    audioData,
    audioName,
    audioVolume,
    audioOffsetFrames,
    setFrame,
    setDuration,
    setFps,
    setAudioTrack,
    clearAudioTrack,
    setAudioVolume,
    setAudioOffsetFrames,
    play,
    stop,
    applyKeyframes,
    getKeyframesForBone,
    deleteKeyframe,
  } = useAnimationStore();

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (!audioData) return;

    const audio = new Audio(audioData);
    audio.preload = 'auto';
    audio.volume = audioVolume;
    audio.currentTime = Math.max(0, frame / fps - audioOffsetFrames / fps);
    audioRef.current = audio;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [audioData]);

  useEffect(() => {
    if (!audioData) {
      setWaveformPeaks([]);
      setAudioDurationSeconds(0);
      return;
    }

    let cancelled = false;

    const decodeWaveform = async () => {
      try {
        if (typeof window === 'undefined' || !('AudioContext' in window)) {
          setWaveformPeaks([]);
          setAudioDurationSeconds(0);
          return;
        }

        audioContextRef.current ??= new AudioContext();
        const arrayBuffer = await dataUrlToArrayBuffer(audioData);
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        setAudioDurationSeconds(audioBuffer.duration);
        setWaveformPeaks(extractWaveformPeaks(channelData, MAX_WAVEFORM_SAMPLES));
      } catch (error) {
        console.error('Failed to decode waveform audio:', error);
        if (!cancelled) {
          setWaveformPeaks([]);
          setAudioDurationSeconds(0);
        }
      }
    };

    void decodeWaveform();

    return () => {
      cancelled = true;
    };
  }, [audioData]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = audioVolume;
  }, [audioVolume]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) return;
    const timelineTime = getAudioTimelineTime(frame, fps, audioOffsetFrames);
    const targetTime = clamp(timelineTime, 0, audioDurationSeconds || 0);
    if (Math.abs(audioRef.current.currentTime - targetTime) > 0.05) {
      audioRef.current.currentTime = targetTime;
    }
  }, [frame, fps, playing, audioOffsetFrames, audioDurationSeconds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const timelineTime = getAudioTimelineTime(frame, fps, audioOffsetFrames);

    if (playing && mode === 'animate') {
      if (!isAudioTimelineActive(timelineTime, audioDurationSeconds)) {
        audio.pause();
        audio.currentTime = clamp(timelineTime, 0, audioDurationSeconds || 0);
        wasPlayingRef.current = false;
        return;
      }

      const drift = Math.abs(audio.currentTime - timelineTime);
      if (!wasPlayingRef.current || drift > 0.15) {
        audio.currentTime = timelineTime;
      }

      if (!wasPlayingRef.current || audio.paused) {
        void audio.play().catch((error) => {
          console.error('Failed to play preview audio:', error);
        });
      }

      wasPlayingRef.current = true;
      return;
    }

    audio.pause();
    wasPlayingRef.current = false;
  }, [playing, mode, frame, fps, audioOffsetFrames, audioDurationSeconds]);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth } = wrapRef.current;
      const audioRowH = audioData ? AUDIO_ROW_H : 0;
      const requiredHeight = HEADER_H + audioRowH + bones.length * ROW_H;
      
      canvasRef.current.width = clientWidth;
      canvasRef.current.height = requiredHeight;
      setResizeTick((tick) => tick + 1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [bones.length, audioData]);

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [isDragging]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawTimeline(
      ctx,
      bones,
      skins,
      keyframes,
      frame,
      duration,
      selectedBoneId,
      selectedBoneIds,
      {
        enabled: Boolean(audioData),
        name: audioName,
        offsetFrames: audioOffsetFrames,
        audioDurationFrames: Math.max(0, Math.round(audioDurationSeconds * fps)),
        waveformPeaks,
      },
      canvas.width,
      canvas.height,
    );
  }, [bones, skins, keyframes, frame, duration, selectedBoneId, selectedBoneIds, resizeTick, audioData, audioName, audioOffsetFrames, audioDurationSeconds, fps, waveformPeaks]);

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
    
    const audioRowH = audioData ? AUDIO_ROW_H : 0;
    const frameW = Math.max(8, (rect.width - HEADER_W) / duration);
    
    if (sx < HEADER_W) return null;
    
    const boneIndex = Math.floor((sy - HEADER_H - audioRowH) / ROW_H);
    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    
    const bone = bones[boneIndex];
    const boneKeyframes = keyframes[bone.id];
    if (!boneKeyframes) return null;
    
    for (const kf of Object.keys(boneKeyframes)) {
      const kfFrame = parseInt(kf);
      const kfX = HEADER_W + kfFrame * frameW;
      const kfY = HEADER_H + audioRowH + boneIndex * ROW_H + ROW_H / 2;
      
      const dist = Math.hypot(sx - kfX, sy - kfY);
      if (dist < 8) {
        return { boneId: bone.id, frame: kfFrame };
      }
    }
    
    return null;
  };

  const getBoneAtPosition = (sy: number) => {
    const audioRowH = audioData ? AUDIO_ROW_H : 0;
    const boneIndex = Math.floor((sy - HEADER_H - audioRowH) / ROW_H);

    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    return bones[boneIndex] ?? null;
  };

  const isAudioTrackHit = (sy: number) => audioData && sy >= HEADER_H && sy <= HEADER_H + AUDIO_ROW_H;

  const getFrameFromX = (sx: number, width: number) => {
    const frameW = Math.max(8, (width - HEADER_W) / duration);
    return Math.round(clamp((sx - HEADER_W) / frameW, 0, duration));
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

    if (isAudioTrackHit(sy) && sx > HEADER_W && audioData) {
      setIsDragging(true);
      setDragMode('audio-offset');
      setAudioOffsetFrames(getFrameFromX(sx, rect.width));
      return;
    }

    if (sx > HEADER_W) {
      setIsDragging(true);
      setDragMode('playhead');
      const newFrame = getFrameFromX(sx, rect.width);
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

    if (dragMode === 'audio-offset' && audioData) {
      setAudioOffsetFrames(getFrameFromX(sx, rect.width));
      return;
    }

    const newFrame = getFrameFromX(sx, rect.width);
    setFrame(newFrame);
    if (mode === 'animate') applyKeyframes();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragMode(null);
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
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleAudioImport = async () => {
    try {
      const audioFile = await openAudioFile({ filters: AUDIO_FILTERS });
      if (!audioFile) return;
      setAudioTrack(audioFile.dataUrl, audioFile.name);
    } catch (error) {
      console.error('Failed to load audio file:', error);
      alert('Failed to load audio file. Check console for details.');
    }
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
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={() => void handleAudioImport()}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-xs"
          title="Import preview audio"
        >
          <Music2 size={12} />
        </button>
        <button
          onClick={clearAudioTrack}
          disabled={!audioData}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-red-500 hover:border-red-500 transition-all text-xs disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
          title="Remove preview audio"
        >
          <X size={12} />
        </button>
        <span className="max-w-[160px] truncate text-[10px] text-text-dim">
          {audioName ?? 'No audio'}
        </span>
        {audioData && (
          <>
            <span className="text-text-dim text-[10px]">Start:</span>
            <input
              type="number"
              value={audioOffsetFrames}
              onChange={(e) => setAudioOffsetFrames(parseInt(e.target.value) || 0)}
              className="w-12 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
              min="0"
              max={duration}
              title="Audio start frame offset"
            />
            <span className="text-text-dim text-[10px]">
              {audioDurationSeconds.toFixed(2)}s
            </span>
          </>
        )}
        <span className="text-text-dim text-[10px]">Vol:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={audioVolume}
          onChange={(e) => setAudioVolume(parseFloat(e.target.value))}
          className="w-20 accent-accent"
          title="Preview audio volume"
        />
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
          style={{ cursor: dragMode === 'audio-offset' ? 'grabbing' : hoveredKeyframe ? 'pointer' : 'default' }}
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
