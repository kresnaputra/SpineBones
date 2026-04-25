import { useRef, useEffect, useState, useEffectEvent } from "react";
import type { KeyframeEasing } from "../../types";
import {
  Play,
  Pause,
  Square,
  ChevronLeft,
  ChevronRight,
  Music2,
  X,
  Diamond,
} from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useSkeletonStore } from "../../stores/skeletonStore";
import { useAnimationStore } from "../../stores/animationStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useSlotStore } from "../../stores/slotStore";
import {
  drawTimeline,
  drawTimelineHeader,
} from "../../engine/timelineRenderer";
import { openAudioFile } from "../../utils/nativeIO";
import { normalizeKeyframeEasing } from "../../utils/easing";
import { getMeshAttachmentKey } from "../../utils/meshAttachment";

const HEADER_H = 20;
const ROW_H = 28;
const AUDIO_ROW_H = 36;
const HEADER_W = 120;
const TIMELINE_PADDING_RIGHT = 50;
const MAX_WAVEFORM_SAMPLES = 240;

const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["mp3", "wav", "ogg", "m4a", "aac", "webm"],
  },
];

const EASING_OPTIONS: Array<{ value: KeyframeEasing; label: string }> = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease In" },
  { value: "easeOut", label: "Ease Out" },
  { value: "easeInOut", label: "Ease In-Out" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const dataUrlToArrayBuffer = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return await response.arrayBuffer();
};

const getAudioTimelineTime = (
  frame: number,
  fps: number,
  audioOffsetFrames: number,
) => frame / fps - audioOffsetFrames / fps;

const isAudioTimelineActive = (
  timelineTime: number,
  audioDurationSeconds: number,
) => timelineTime >= 0 && timelineTime < audioDurationSeconds;

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
  const headerCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wasPlayingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<
    "playhead" | "audio-offset" | "keyframe" | null
  >(null);
  const [draggedKeyframe, setDraggedKeyframe] = useState<{
    boneId: number;
    frame: number;
  } | null>(null);
  const [draggedKeyframeSelection, setDraggedKeyframeSelection] = useState<
    Array<{ boneId: number; frame: number }>
  >([]);
  const [selectedKeyframes, setSelectedKeyframes] = useState<
    Array<{ boneId: number; frame: number }>
  >([]);
  const [copiedKeyframes, setCopiedKeyframes] = useState<
    Array<{
      boneId: number;
      sourceFrame: number;
      data: {
        x: number;
        y: number;
        rotation: number;
        scaleX: number;
        scaleY: number;
        easing?: KeyframeEasing;
      };
      attachmentOpacityKeys: Array<{
        attachmentKey: string;
        opacity: number;
        easing?: KeyframeEasing;
      }>;
      meshDeformKeys: Array<{
        attachmentKey: string;
        vertices: Array<{ x: number; y: number }>;
        easing?: KeyframeEasing;
      }>;
    }>
  >([]);
  const [hoveredKeyframe, setHoveredKeyframe] = useState<{
    boneId: number;
    frame: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    boneId: number;
    frame: number;
  } | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [fpsInput, setFpsInput] = useState<string>("");
  const [durationInput, setDurationInput] = useState<string>("");
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [scrollOffsetX, setScrollOffsetX] = useState(0);

  const { mode, selectedBoneId, selectedBoneIds, selectBone } =
    useEditorStore();
  const { bones, skins } = useSkeletonStore();
  const { slots } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();
  const {
    keyframes,
    meshDeformKeyframes,
    attachmentOpacityKeyframes,
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
    insertKeyframe,
    setMeshDeformKeyframeAtFrame,
    setAttachmentOpacityKeyframeAtFrame,
    updateKeyframeEasing,
    moveKeyframe,
    moveMeshDeformKeyframe,
    moveAttachmentOpacityKeyframe,
    updateMeshDeformKeyframeEasing,
    updateAttachmentOpacityKeyframeEasing,
    deleteKeyframe,
    deleteMeshDeformKeyframe,
    deleteAttachmentOpacityKeyframe,
    clearKeyframes,
  } = useAnimationStore();

  const deleteAttachmentOpacityKeysAtFrame = (
    boneId: number,
    targetFrame: number,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        deleteAttachmentOpacityKeyframe(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          targetFrame,
        );
      });
  };

  const collectAttachmentOpacityKeysAtFrame = (
    boneId: number,
    targetFrame: number,
  ) =>
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .flatMap((slot) => {
        if (!slot.attachmentName) return [];
        const attachmentKey = getMeshAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName,
        });
        const key = attachmentOpacityKeyframes[attachmentKey]?.[targetFrame];
        if (!key) return [];
        return [
          {
            attachmentKey,
            opacity: key.opacity,
            easing: normalizeKeyframeEasing(key.easing),
          },
        ];
      });

  const collectMeshDeformKeysAtFrame = (boneId: number, targetFrame: number) =>
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .flatMap((slot) => {
        if (!slot.attachmentName) return [];
        const attachmentKey = getMeshAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName,
        });
        const key = meshDeformKeyframes[attachmentKey]?.[targetFrame];
        if (!key) return [];
        return [
          {
            attachmentKey,
            vertices: key.vertices.map((vertex) => ({
              x: vertex.x,
              y: vertex.y,
            })),
            easing: normalizeKeyframeEasing(key.easing),
          },
        ];
      });

  const clearAttachmentOpacityKeysForBone = (boneId: number) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        const attachmentKey = getMeshAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName,
        });
        const attachmentFrames = Object.keys(
          attachmentOpacityKeyframes[attachmentKey] ?? {},
        ).map(Number);
        attachmentFrames.forEach((targetFrame) =>
          deleteAttachmentOpacityKeyframe(attachmentKey, targetFrame),
        );
      });
  };

  const clearMeshDeformKeysForBone = (boneId: number) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        const attachmentKey = getMeshAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName,
        });
        const deformFrames = Object.keys(
          meshDeformKeyframes[attachmentKey] ?? {},
        ).map(Number);
        deformFrames.forEach((targetFrame) =>
          deleteMeshDeformKeyframe(attachmentKey, targetFrame),
        );
      });
  };

  const deleteMeshDeformKeysAtFrame = (boneId: number, targetFrame: number) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        deleteMeshDeformKeyframe(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          targetFrame,
        );
      });
  };

  const moveAttachmentOpacityKeysAtFrame = (
    boneId: number,
    fromFrame: number,
    toFrame: number,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        moveAttachmentOpacityKeyframe(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          fromFrame,
          toFrame,
        );
      });
  };

  const moveMeshDeformKeysAtFrame = (
    boneId: number,
    fromFrame: number,
    toFrame: number,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        moveMeshDeformKeyframe(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          fromFrame,
          toFrame,
        );
      });
  };

  const updateAttachmentOpacityEasingAtFrame = (
    boneId: number,
    targetFrame: number,
    easing: KeyframeEasing,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        updateAttachmentOpacityKeyframeEasing(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          targetFrame,
          easing,
        );
      });
  };

  const updateMeshDeformEasingAtFrame = (
    boneId: number,
    targetFrame: number,
    easing: KeyframeEasing,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        updateMeshDeformKeyframeEasing(
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          targetFrame,
          easing,
        );
      });
  };

  useEffect(() => {
    setFpsInput(String(fps));
  }, [fps]);
  useEffect(() => {
    setDurationInput(String(duration));
  }, [duration]);

  const commitFps = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const clamped = Number.isFinite(parsed)
      ? Math.max(1, Math.min(120, parsed))
      : 1;
    captureSnapshot();
    setFps(clamped);
    setFpsInput(String(clamped));
  };

  const commitDuration = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const clamped = Number.isFinite(parsed)
      ? Math.max(10, Math.min(300, parsed))
      : 10;
    captureSnapshot();
    setDuration(clamped);
    setDurationInput(String(clamped));
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (!audioData) return;

    const audio = new Audio(audioData);
    audio.preload = "auto";
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
        if (typeof window === "undefined" || !("AudioContext" in window)) {
          setWaveformPeaks([]);
          setAudioDurationSeconds(0);
          return;
        }

        audioContextRef.current ??= new AudioContext();
        const arrayBuffer = await dataUrlToArrayBuffer(audioData);
        const audioBuffer = await audioContextRef.current.decodeAudioData(
          arrayBuffer.slice(0),
        );
        if (cancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        setAudioDurationSeconds(audioBuffer.duration);
        setWaveformPeaks(
          extractWaveformPeaks(channelData, MAX_WAVEFORM_SAMPLES),
        );
      } catch (error) {
        console.error("Failed to decode waveform audio:", error);
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

    if (playing && mode === "animate") {
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
          console.error("Failed to play preview audio:", error);
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
      const bodyHeight = audioRowH + bones.length * ROW_H;

      canvasRef.current.width = clientWidth;
      canvasRef.current.height = bodyHeight;
      if (headerCanvasRef.current) {
        headerCanvasRef.current.width = clientWidth;
        headerCanvasRef.current.height = HEADER_H;
      }
      setResizeTick((tick) => tick + 1);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [bones.length, audioData]);

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
      setDraggedKeyframe(null);
      setDraggedKeyframeSelection([]);
    };

    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, [isDragging]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawTimeline(
      ctx,
      bones,
      skins,
      keyframes,
      selectedKeyframes,
      frame,
      duration,
      selectedBoneId,
      selectedBoneIds,
      {
        enabled: Boolean(audioData),
        name: audioName,
        offsetFrames: audioOffsetFrames,
        audioDurationFrames: Math.max(
          0,
          Math.round(audioDurationSeconds * fps),
        ),
        waveformPeaks,
      },
      canvas.width,
      canvas.height,
      scrollOffsetX,
      getFrameW(canvas.width),
    );
  }, [
    bones,
    skins,
    keyframes,
    selectedKeyframes,
    frame,
    duration,
    selectedBoneId,
    selectedBoneIds,
    resizeTick,
    audioData,
    audioName,
    audioOffsetFrames,
    audioDurationSeconds,
    fps,
    waveformPeaks,
    scrollOffsetX,
    timelineZoom,
  ]);

  useEffect(() => {
    const canvas = headerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawTimelineHeader(
      ctx,
      frame,
      duration,
      canvas.width,
      canvas.height,
      scrollOffsetX,
      getFrameW(canvas.width),
    );
  }, [frame, duration, resizeTick, scrollOffsetX, timelineZoom]);

  useEffect(() => {
    setSelectedKeyframes((current) =>
      current.filter(({ boneId, frame: keyframeFrame }) =>
        Boolean(keyframes[boneId]?.[keyframeFrame]),
      ),
    );
  }, [keyframes]);

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
    if (playing && mode === "animate") {
      applyKeyframes();
    }
  }, [frame, playing, mode, applyKeyframes]);

  const getFrameW = (canvasWidth: number) =>
    Math.max(8, (canvasWidth - HEADER_W - TIMELINE_PADDING_RIGHT) / duration) *
    timelineZoom;

  const getMaxScrollX = (canvasWidth: number) =>
    Math.max(
      0,
      getFrameW(canvasWidth) * duration +
        TIMELINE_PADDING_RIGHT -
        (canvasWidth - HEADER_W),
    );

  const getKeyframeAtPosition = (
    sx: number,
    sy: number,
  ): { boneId: number; frame: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const audioRowH = audioData ? AUDIO_ROW_H : 0;
    const frameW = getFrameW(rect.width);

    if (sx < HEADER_W) return null;

    const boneIndex = Math.floor((sy - audioRowH) / ROW_H);
    if (boneIndex < 0 || boneIndex >= bones.length) return null;

    const bone = bones[boneIndex];
    const boneKeyframes = keyframes[bone.id];
    if (!boneKeyframes) return null;

    for (const kf of Object.keys(boneKeyframes)) {
      const kfFrame = parseInt(kf);
      const kfX = HEADER_W + kfFrame * frameW - scrollOffsetX;
      const kfY = audioRowH + boneIndex * ROW_H + ROW_H / 2;

      const dist = Math.hypot(sx - kfX, sy - kfY);
      if (dist < 8) {
        return { boneId: bone.id, frame: kfFrame };
      }
    }

    return null;
  };

  const getBoneAtPosition = (sy: number) => {
    const audioRowH = audioData ? AUDIO_ROW_H : 0;
    const boneIndex = Math.floor((sy - audioRowH) / ROW_H);

    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    return bones[boneIndex] ?? null;
  };

  const isAudioTrackHit = (sy: number) =>
    audioData && sy >= 0 && sy <= AUDIO_ROW_H;

  const getFrameFromX = (sx: number, width: number) => {
    const frameW = getFrameW(width);
    return Math.round(
      clamp((sx - HEADER_W + scrollOffsetX) / frameW, 0, duration),
    );
  };

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = headerCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    if (sx <= HEADER_W) return;
    const newFrame = getFrameFromX(sx, rect.width);
    setFrame(newFrame);
    if (mode === "animate") applyKeyframes();
    setIsDragging(true);
    setDragMode("playhead");
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
      if (sx < HEADER_W) {
        const boneKeyframes = keyframes[boneHit.id];
        if (boneKeyframes) {
          const allFrames = Object.keys(boneKeyframes).map(Number);
          setSelectedKeyframes(allFrames.map((f) => ({ boneId: boneHit.id, frame: f })));
        }
        return;
      }
    }

    if (e.detail === 2 && keyframeHit) {
      deleteKeyframe(keyframeHit.boneId, keyframeHit.frame);
      deleteAttachmentOpacityKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
      deleteMeshDeformKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
      return;
    }

    if (keyframeHit) {
      setSelectedKeyframes((current) => {
        const nextSelection = (() => {
          if (e.shiftKey) {
            const exists = current.some(
              ({ boneId, frame: keyframeFrame }) =>
                boneId === keyframeHit.boneId &&
                keyframeFrame === keyframeHit.frame,
            );
            if (exists) {
              return current.filter(
                ({ boneId, frame: keyframeFrame }) =>
                  !(
                    boneId === keyframeHit.boneId &&
                    keyframeFrame === keyframeHit.frame
                  ),
              );
            }
            return [...current, keyframeHit];
          }

          const alreadySelected = current.some(
            ({ boneId, frame: keyframeFrame }) =>
              boneId === keyframeHit.boneId &&
              keyframeFrame === keyframeHit.frame,
          );
          return alreadySelected ? current : [keyframeHit];
        })();

        setDraggedKeyframeSelection(nextSelection);
        return nextSelection;
      });
      captureSnapshot();
      setIsDragging(true);
      setDragMode("keyframe");
      setDraggedKeyframe(keyframeHit);
      selectBone(keyframeHit.boneId);
      setFrame(keyframeHit.frame);
      if (mode === "animate") applyKeyframes();
      return;
    }

    if (!e.shiftKey) {
      setSelectedKeyframes([]);
    }

    if (isAudioTrackHit(sy) && sx > HEADER_W && audioData) {
      setIsDragging(true);
      setDragMode("audio-offset");
      setAudioOffsetFrames(getFrameFromX(sx, rect.width));
      return;
    }

    if (sx > HEADER_W) {
      setIsDragging(true);
      setDragMode("playhead");
      const newFrame = getFrameFromX(sx, rect.width);
      setFrame(newFrame);
      if (mode === "animate") applyKeyframes();
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

    if (dragMode === "audio-offset" && audioData) {
      setAudioOffsetFrames(getFrameFromX(sx, rect.width));
      return;
    }

    if (dragMode === "keyframe" && draggedKeyframe) {
      const newFrame = getFrameFromX(sx, rect.width);
      if (newFrame !== draggedKeyframe.frame) {
        const delta = newFrame - draggedKeyframe.frame;
        const activeSelection =
          draggedKeyframeSelection.length > 0
            ? draggedKeyframeSelection
            : [draggedKeyframe];

        activeSelection.forEach((keyframe) => {
          moveKeyframe(keyframe.boneId, keyframe.frame, keyframe.frame + delta);
          moveAttachmentOpacityKeysAtFrame(
            keyframe.boneId,
            keyframe.frame,
            keyframe.frame + delta,
          );
          moveMeshDeformKeysAtFrame(
            keyframe.boneId,
            keyframe.frame,
            keyframe.frame + delta,
          );
        });

        setDraggedKeyframeSelection((current) =>
          current.map((keyframe) => ({
            boneId: keyframe.boneId,
            frame: keyframe.frame + delta,
          })),
        );
        setSelectedKeyframes((current) =>
          current.map((keyframe) => ({
            boneId: keyframe.boneId,
            frame: keyframe.frame + delta,
          })),
        );
        setDraggedKeyframe({
          boneId: draggedKeyframe.boneId,
          frame: newFrame,
        });
      }
      setFrame(newFrame);
      if (mode === "animate") applyKeyframes();
      return;
    }

    const newFrame = getFrameFromX(sx, rect.width);
    setFrame(newFrame);
    if (mode === "animate") applyKeyframes();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragMode(null);
    setDraggedKeyframe(null);
    setDraggedKeyframeSelection([]);
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
      deleteAttachmentOpacityKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
      deleteMeshDeformKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
    }
  };

  const handleDeleteFromContextMenu = () => {
    if (contextMenu) {
      deleteKeyframe(contextMenu.boneId, contextMenu.frame);
      deleteAttachmentOpacityKeysAtFrame(contextMenu.boneId, contextMenu.frame);
      deleteMeshDeformKeysAtFrame(contextMenu.boneId, contextMenu.frame);
      setContextMenu(null);
    }
  };

  const handleCopySelectedKeyframes = () => {
    if (selectedKeyframes.length === 0) return;

    const nextClipboard = selectedKeyframes
      .map(({ boneId, frame: sourceFrame }) => {
        const data = keyframes[boneId]?.[sourceFrame];
        if (!data) return null;

        return {
          boneId,
          sourceFrame,
          data: {
            x: data.x,
            y: data.y,
            rotation: data.rotation,
            scaleX: data.scaleX,
            scaleY: data.scaleY,
            easing: normalizeKeyframeEasing(data.easing),
          },
          attachmentOpacityKeys: collectAttachmentOpacityKeysAtFrame(
            boneId,
            sourceFrame,
          ),
          meshDeformKeys: collectMeshDeformKeysAtFrame(boneId, sourceFrame),
        };
      })
      .filter(
        (
          item,
        ): item is NonNullable<(typeof copiedKeyframes)[number]> => item !== null,
      );

    if (nextClipboard.length === 0) return;
    setCopiedKeyframes(nextClipboard);
  };

  const handlePasteCopiedKeyframes = () => {
    if (copiedKeyframes.length === 0) return;

    const minFrame = Math.min(...copiedKeyframes.map((item) => item.sourceFrame));
    captureSnapshot();

    const nextSelection = copiedKeyframes.map((item) => {
      const targetFrame = Math.max(0, frame + (item.sourceFrame - minFrame));

      useAnimationStore.getState().setFrame(targetFrame);
      insertKeyframe(item.boneId, { ...item.data });

      item.attachmentOpacityKeys.forEach((attachmentKey) => {
        setAttachmentOpacityKeyframeAtFrame(
          attachmentKey.attachmentKey,
          targetFrame,
          attachmentKey.opacity,
        );
        updateAttachmentOpacityKeyframeEasing(
          attachmentKey.attachmentKey,
          targetFrame,
          normalizeKeyframeEasing(attachmentKey.easing),
        );
      });

      item.meshDeformKeys.forEach((attachmentKey) => {
        setMeshDeformKeyframeAtFrame(
          attachmentKey.attachmentKey,
          targetFrame,
          attachmentKey.vertices,
        );
        updateMeshDeformKeyframeEasing(
          attachmentKey.attachmentKey,
          targetFrame,
          normalizeKeyframeEasing(attachmentKey.easing),
        );
      });

      return { boneId: item.boneId, frame: targetFrame };
    });

    setSelectedKeyframes(nextSelection);
    useAnimationStore.getState().setFrame(frame);
    if (mode === "animate") {
      applyKeyframes();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const isModifierPressed = e.metaKey || e.ctrlKey;

      if (isModifierPressed && (e.key === "c" || e.key === "C")) {
        if (selectedKeyframes.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handleCopySelectedKeyframes();
        return;
      }

      if (isModifierPressed && (e.key === "v" || e.key === "V")) {
        if (copiedKeyframes.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handlePasteCopiedKeyframes();
        return;
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedKeyframes.length > 0
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        captureSnapshot();
        selectedKeyframes.forEach((keyframe) => {
          deleteKeyframe(keyframe.boneId, keyframe.frame);
          deleteAttachmentOpacityKeysAtFrame(keyframe.boneId, keyframe.frame);
          deleteMeshDeformKeysAtFrame(keyframe.boneId, keyframe.frame);
        });
        setSelectedKeyframes([]);
        return;
      }

      if (
        (e.key === "x" || e.key === "X" || e.key === "Delete") &&
        hoveredKeyframe
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        deleteKeyframe(hoveredKeyframe.boneId, hoveredKeyframe.frame);
        deleteAttachmentOpacityKeysAtFrame(
          hoveredKeyframe.boneId,
          hoveredKeyframe.frame,
        );
        deleteMeshDeformKeysAtFrame(
          hoveredKeyframe.boneId,
          hoveredKeyframe.frame,
        );
      }
    };

    const handleClickOutside = () => {
      setContextMenu(null);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("click", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("click", handleClickOutside);
    };
  }, [
    copiedKeyframes,
    frame,
    mode,
    hoveredKeyframe,
    selectedKeyframes,
    captureSnapshot,
    deleteKeyframe,
    insertKeyframe,
    slots,
    attachmentOpacityKeyframes,
    meshDeformKeyframes,
    deleteAttachmentOpacityKeyframe,
    deleteMeshDeformKeyframe,
    setAttachmentOpacityKeyframeAtFrame,
    setMeshDeformKeyframeAtFrame,
    updateAttachmentOpacityKeyframeEasing,
    updateMeshDeformKeyframeEasing,
    applyKeyframes,
  ]);

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

  const handleInsertKeyframe = () => {
    if (selectedBoneIds.length === 0) return;

    captureSnapshot();
    selectedBoneIds.forEach((boneId) => {
      const bone = bones.find((item) => item.id === boneId);
      if (!bone) return;

      insertKeyframe(bone.id, {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY,
      });
    });
  };

  const handleClearKeyframes = () => {
    const targetBoneIds = Array.from(
      new Set([
        ...bones.map((bone) => bone.id),
        ...slots.map((slot) => slot.boneId),
      ]),
    );
    if (targetBoneIds.length === 0) return;

    captureSnapshot();
    targetBoneIds.forEach((boneId) => {
      clearKeyframes(boneId);
      clearAttachmentOpacityKeysForBone(boneId);
      clearMeshDeformKeysForBone(boneId);
    });
    setSelectedKeyframes([]);
  };

  const handleLoopKeyframes = () => {
    const animState = useAnimationStore.getState();
    const targetBoneIds = Array.from(
      new Set([
        ...Object.keys(animState.keyframes).map(Number),
        ...slots.map((slot) => slot.boneId),
      ]),
    );
    if (targetBoneIds.length === 0) return;

    const visibleBoneFrames = targetBoneIds.flatMap((boneId) =>
      Object.keys(animState.keyframes[boneId] ?? {}).map(Number),
    );
    const allAttachmentFrames = targetBoneIds.flatMap((boneId) => {
      const slotAttachmentKeys = slots
        .filter((slot) => slot.boneId === boneId && slot.attachmentName)
        .map((slot) =>
          getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName!,
          }),
        );

      return [
        ...slotAttachmentKeys.flatMap((attachmentKey) =>
          Object.keys(animState.attachmentOpacityKeyframes[attachmentKey] ?? {}).map(Number),
        ),
        ...slotAttachmentKeys.flatMap((attachmentKey) =>
          Object.keys(animState.meshDeformKeyframes[attachmentKey] ?? {}).map(Number),
        ),
      ];
    });

    const loopFrames =
      visibleBoneFrames.length > 0 ? visibleBoneFrames : allAttachmentFrames;
    if (loopFrames.length < 2) return;

    captureSnapshot();

    const loopStart = Math.min(...loopFrames);
    const loopEnd = Math.max(...loopFrames);

    for (const boneId of targetBoneIds) {
      const boneKfs = animState.keyframes[boneId];
      const boneFrames = Object.keys(boneKfs ?? {})
        .map(Number)
        .sort((a, b) => a - b);

      if (boneKfs && boneFrames.length >= 2) {
        const reversed = boneFrames
          .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
          .reverse();

        for (const srcFrame of reversed) {
          const destFrame = loopEnd + (loopEnd - srcFrame);
          useAnimationStore.getState().setFrame(destFrame);
          useAnimationStore
            .getState()
            .insertKeyframe(boneId, { ...boneKfs[srcFrame] });
        }
      }

      slots
        .filter((slot) => slot.boneId === boneId && slot.attachmentName)
        .forEach((slot) => {
          if (!slot.attachmentName) return;

          const attachmentKey = getMeshAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          });

          const opacityFrames = Object.keys(
            attachmentOpacityKeyframes[attachmentKey] ?? {},
          )
            .map(Number)
            .sort((a, b) => a - b);

          if (opacityFrames.length >= 2) {
            const reversed = opacityFrames
              .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
              .reverse();

            reversed.forEach((srcFrame) => {
              const source = attachmentOpacityKeyframes[attachmentKey]?.[srcFrame];
              if (!source) return;
              const destFrame = loopEnd + (loopEnd - srcFrame);
              setAttachmentOpacityKeyframeAtFrame(
                attachmentKey,
                destFrame,
                source.opacity,
              );
              updateAttachmentOpacityKeyframeEasing(
                attachmentKey,
                destFrame,
                normalizeKeyframeEasing(source.easing),
              );
            });
          }

          const deformFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {})
            .map(Number)
            .sort((a, b) => a - b);

          if (deformFrames.length >= 2) {
            const reversed = deformFrames
              .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
              .reverse();

            reversed.forEach((srcFrame) => {
              const source = meshDeformKeyframes[attachmentKey]?.[srcFrame];
              if (!source) return;
              const destFrame = loopEnd + (loopEnd - srcFrame);
              setMeshDeformKeyframeAtFrame(
                attachmentKey,
                destFrame,
                source.vertices,
              );
              updateMeshDeformKeyframeEasing(
                attachmentKey,
                destFrame,
                normalizeKeyframeEasing(source.easing),
              );
            });
          }
        });
    }

    useAnimationStore.getState().setFrame(0);
  };

  const handleCopyFirstKeyframe = () => {
    if (selectedBoneId === null) return;

    const animState = useAnimationStore.getState();
    const boneKeyframes = animState.keyframes[selectedBoneId];
    if (!boneKeyframes) return;

    const frames = Object.keys(boneKeyframes)
      .map(Number)
      .sort((a, b) => a - b);
    if (frames.length === 0) return;

    const firstKey = boneKeyframes[frames[0]];
    if (!firstKey) return;

    captureSnapshot();
    insertKeyframe(selectedBoneId, { ...firstKey });

    slots
      .filter((slot) => slot.boneId === selectedBoneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;

        const attachmentKey = getMeshAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName,
        });
        const opacityFrames = Object.keys(
          attachmentOpacityKeyframes[attachmentKey] ?? {},
        )
          .map(Number)
          .sort((a, b) => a - b);
        if (opacityFrames.length > 0) {
          const firstOpacityFrame = opacityFrames[0];
          const firstOpacityKey =
            attachmentOpacityKeyframes[attachmentKey]?.[firstOpacityFrame];
          if (firstOpacityKey) {
            setAttachmentOpacityKeyframeAtFrame(
              attachmentKey,
              frame,
              firstOpacityKey.opacity,
            );
            updateAttachmentOpacityKeyframeEasing(
              attachmentKey,
              frame,
              normalizeKeyframeEasing(firstOpacityKey.easing),
            );
          }
        }

        const deformFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {})
          .map(Number)
          .sort((a, b) => a - b);
        if (deformFrames.length > 0) {
          const firstDeformFrame = deformFrames[0];
          const firstDeformKey =
            meshDeformKeyframes[attachmentKey]?.[firstDeformFrame];
          if (firstDeformKey) {
            setMeshDeformKeyframeAtFrame(
              attachmentKey,
              frame,
              firstDeformKey.vertices,
            );
            updateMeshDeformKeyframeEasing(
              attachmentKey,
              frame,
              normalizeKeyframeEasing(firstDeformKey.easing),
            );
          }
        }
      });
  };

  const handleSelectFrameKeyframes = () => {
    const frameKeyframes = bones.flatMap((bone) =>
      Object.keys(keyframes[bone.id] ?? {})
        .filter((keyframeFrame) => Number(keyframeFrame) === frame)
        .map((keyframeFrame) => ({
          boneId: bone.id,
          frame: Number(keyframeFrame),
        })),
    );

    setSelectedKeyframes(frameKeyframes);
  };

  const handleAudioImport = async () => {
    try {
      const audioFile = await openAudioFile({ filters: AUDIO_FILTERS });
      if (!audioFile) return;
      setAudioTrack(audioFile.dataUrl, audioFile.name);
    } catch (error) {
      console.error("Failed to load audio file:", error);
      alert("Failed to load audio file. Check console for details.");
    }
  };

  const selectedKeyframeEasing =
    selectedKeyframes.length === 0
      ? ""
      : (() => {
          const values = selectedKeyframes
            .map(
              ({ boneId, frame: keyframeFrame }) =>
                keyframes[boneId]?.[keyframeFrame]?.easing,
            )
            .filter(Boolean)
            .map((value) => normalizeKeyframeEasing(value));

          if (values.length === 0) return "linear";
          const first = values[0];
          return values.every((value) => value === first) ? first : "";
        })();

  const hasAnyAnimationData =
    Object.keys(keyframes).length > 0 ||
    Object.keys(attachmentOpacityKeyframes).length > 0 ||
    Object.keys(meshDeformKeyframes).length > 0;

  const handleEasingChange = (value: string) => {
    if (!value || selectedKeyframes.length === 0) return;

    captureSnapshot();
    selectedKeyframes.forEach(({ boneId, frame: keyframeFrame }) => {
      updateKeyframeEasing(boneId, keyframeFrame, value as KeyframeEasing);
      updateAttachmentOpacityEasingAtFrame(
        boneId,
        keyframeFrame,
        value as KeyframeEasing,
      );
      updateMeshDeformEasingAtFrame(
        boneId,
        keyframeFrame,
        value as KeyframeEasing,
      );
    });
  };

  const handlePrevKeyUiEvent = useEffectEvent(() => {
    handlePrevKey();
  });

  const handleNextKeyUiEvent = useEffectEvent(() => {
    handleNextKey();
  });

  const handleSelectFrameKeysUiEvent = useEffectEvent(() => {
    handleSelectFrameKeyframes();
  });

  const handleCopyFirstKeyUiEvent = useEffectEvent(() => {
    handleCopyFirstKeyframe();
  });

  useEffect(() => {
    window.addEventListener("spine:timeline-prev-key", handlePrevKeyUiEvent);
    window.addEventListener("spine:timeline-next-key", handleNextKeyUiEvent);
    window.addEventListener(
      "spine:timeline-select-frame-keys",
      handleSelectFrameKeysUiEvent,
    );
    window.addEventListener(
      "spine:timeline-copy-first-key",
      handleCopyFirstKeyUiEvent,
    );

    return () => {
      window.removeEventListener(
        "spine:timeline-prev-key",
        handlePrevKeyUiEvent,
      );
      window.removeEventListener(
        "spine:timeline-next-key",
        handleNextKeyUiEvent,
      );
      window.removeEventListener(
        "spine:timeline-select-frame-keys",
        handleSelectFrameKeysUiEvent,
      );
      window.removeEventListener(
        "spine:timeline-copy-first-key",
        handleCopyFirstKeyUiEvent,
      );
    };
  }, []);

  const handleCanvasWheel = useEffectEvent((e: WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxX = getMaxScrollX(canvas.width);
    if (e.altKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setTimelineZoom((z) => Math.max(1, Math.min(20, z * zoomFactor)));
      setScrollOffsetX((prev) => Math.max(0, Math.min(maxX, prev)));
    } else if (e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY || e.deltaX;
      setScrollOffsetX((prev) => Math.max(0, Math.min(maxX, prev + delta)));
    } else if (Math.abs(e.deltaX) > 0) {
      e.preventDefault();
      setScrollOffsetX((prev) => Math.max(0, Math.min(maxX, prev + e.deltaX)));
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, []);

  return (
    <div className="h-[190px] flex-shrink-0 bg-panel border-t border-border flex flex-col">
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
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={handleInsertKeyframe}
          disabled={selectedBoneIds.length === 0}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
          title="Insert keyframe for selected bones (K)"
        >
          <Diamond size={12} fill="currentColor" />
          Key
        </button>
        <button
          onClick={handleClearKeyframes}
          disabled={!hasAnyAnimationData}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
          title="Clear all keyframes in the timeline"
        >
          <X size={12} />
          Clear
        </button>
        <button
          onClick={handleLoopKeyframes}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px]"
          title="Mirror keyframes in reverse to create a seamless loop"
        >
          <Diamond size={12} />
          Loop
        </button>
        <button
          onClick={handleCopyFirstKeyframe}
          disabled={selectedBoneId === null}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
          title="Copy first keyframe to current frame — no selection copies all bones (F)"
        >
          <Diamond size={12} />
          1st Key
        </button>
        <button
          onClick={handleSelectFrameKeyframes}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px]"
          title="Select all keyframes at current frame"
        >
          Select Frame Keys
        </button>
        <span className="text-text-dim text-[10px]">Ease:</span>
        <select
          value={selectedKeyframeEasing}
          onChange={(e) => handleEasingChange(e.target.value)}
          disabled={selectedKeyframes.length === 0}
          className="bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[10px] disabled:opacity-40"
          title="Set easing for selected keyframes"
        >
          <option value="">
            {selectedKeyframes.length === 0 ? "No key" : "Mixed"}
          </option>
          {EASING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
          {audioName ?? "No audio"}
        </span>
        {audioData && (
          <>
            <span className="text-text-dim text-[10px]">Start:</span>
            <input
              type="number"
              value={audioOffsetFrames}
              onChange={(e) =>
                setAudioOffsetFrames(parseInt(e.target.value) || 0)
              }
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
          value={fpsInput}
          onChange={(e) => setFpsInput(e.target.value)}
          onBlur={(e) => commitFps(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitFps((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-10 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
          min="1"
          max="120"
        />
        <span className="text-text-dim text-[10px]">Duration:</span>
        <input
          type="number"
          value={durationInput}
          onChange={(e) => setDurationInput(e.target.value)}
          onBlur={(e) => commitDuration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDuration((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-12 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
          min="10"
          max="300"
        />
      </div>
      <div
        ref={wrapRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-thin"
      >
        <canvas
          ref={headerCanvasRef}
          className="block sticky top-0 z-10"
          onMouseDown={handleHeaderMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: "default" }}
        />
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          className="block"
          style={{
            cursor:
              dragMode === "audio-offset" || dragMode === "keyframe"
                ? "grabbing"
                : hoveredKeyframe
                  ? "pointer"
                  : "default",
          }}
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
      {/* Horizontal scrollbar */}
      <div
        className="h-2.5 bg-panel2 border-t border-border flex-shrink-0 relative"
        style={{ paddingLeft: HEADER_W }}
        onMouseDown={(e) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const maxScroll = getMaxScrollX(canvas.width);
          if (maxScroll <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const trackW = canvas.width - HEADER_W;
          const thumbW = Math.max(20, (trackW * trackW) / (trackW + maxScroll));
          const ratio = Math.max(
            0,
            Math.min(1, (clickX - thumbW / 2) / (trackW - thumbW)),
          );
          setScrollOffsetX(ratio * maxScroll);
        }}
      >
        <div className="relative h-full w-full">
          {(() => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const maxScroll = getMaxScrollX(canvas.width);
            if (maxScroll <= 0) return null;
            const trackW = canvas.width - HEADER_W;
            const thumbW = Math.max(
              20,
              (trackW * trackW) / (trackW + maxScroll),
            );
            const thumbLeft = (scrollOffsetX / maxScroll) * (trackW - thumbW);
            return (
              <div
                className="absolute top-0.5 bottom-0.5 bg-border hover:bg-accent/60 rounded-full cursor-pointer transition-colors"
                style={{ left: thumbLeft, width: thumbW }}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
};
