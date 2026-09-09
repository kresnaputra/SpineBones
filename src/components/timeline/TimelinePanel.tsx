import { useRef, useEffect, useMemo, useState, useEffectEvent } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { KeyframeData, KeyframeEasing, MeshVertex } from "../../types";
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
import { useDeformerStore } from "../../stores/deformerStore";
import {
  drawTimeline,
  drawTimelineHeader,
  type TimelineBone,
} from "../../engine/timelineRenderer";
import { openAudioFile } from "../../utils/nativeIO";
import { normalizeKeyframeEasing } from "../../utils/easing";
import { getAttachmentKey } from "../../utils/attachmentUtils";

const HEADER_H = 20;
const ROW_H = 28;
const AUDIO_ROW_H = 36;
const HEADER_W = 120;
const TIMELINE_PADDING_RIGHT = 50;
const MAX_WAVEFORM_SAMPLES = 240;
const TIMELINE_BONE_KEY_SEPARATOR = "\x1f";

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

type TimelineMarker = {
  kind: "bone" | "sprite";
  boneId: number;
  frame: number;
  slotId?: number;
};

type SpriteSwapMarker = {
  slotId: number;
  frame: number;
  attachmentName: string | null;
};

const isSameTimelineMarker = (a: TimelineMarker, b: TimelineMarker) =>
  a.kind === b.kind &&
  a.boneId === b.boneId &&
  a.frame === b.frame &&
  (a.slotId ?? null) === (b.slotId ?? null);

/**
 * Clipboard for right-click copy/paste. A bone keyframe carries along the
 * sprite swap, opacity, and mesh deform keys that shared its source frame —
 * the same bundle `handleCopyFirstKeyframe` treats as "the keyframe" — so
 * pasting reproduces the full pose rather than just the transform.
 *
 * The clipboard is always an array: copying a single dot yields a one-item
 * array, and copying while a multi-selection is active (see
 * `selectedKeyframes`) captures every selected marker. Each item keeps its own
 * `sourceFrame` so a paste can preserve the selection's relative spacing —
 * the whole group shifts by one offset, computed from the earliest frame in
 * the copy to wherever the paste lands.
 */
type CopiedBoneKeyframe = {
  kind: "bone";
  boneId: number;
  sourceFrame: number;
  bone: KeyframeData;
  sprites: Array<{ slotId: number; attachmentName: string | null }>;
  opacities: Array<{ attachmentKey: string; opacity: number; easing?: KeyframeEasing }>;
  meshes: Array<{
    attachmentKey: string;
    vertices: Array<Pick<MeshVertex, "x" | "y">>;
    easing?: KeyframeEasing;
  }>;
};

type CopiedSpriteKeyframe = {
  kind: "sprite";
  boneId: number;
  slotId: number;
  sourceFrame: number;
  attachmentName: string | null;
};

type CopiedKeyframeItem = CopiedBoneKeyframe | CopiedSpriteKeyframe;

const getAudioSourceKey = (dataUrl: string) =>
  `${dataUrl.length}:${dataUrl.slice(0, 48)}:${dataUrl.slice(-48)}`;

export const TimelinePanel = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headerCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRefs = useRef<Map<number, HTMLAudioElement>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const wasPlayingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<
    "playhead" | "audio-offset" | "keyframe" | null
  >(null);
  const [draggedKeyframe, setDraggedKeyframe] = useState<TimelineMarker | null>(null);
  const [draggedKeyframeSelection, setDraggedKeyframeSelection] = useState<
    TimelineMarker[]
  >([]);
  const [selectedKeyframes, setSelectedKeyframes] = useState<TimelineMarker[]>([]);
  const [hoveredKeyframe, setHoveredKeyframe] = useState<TimelineMarker | null>(null);
  const [copiedKeyframes, setCopiedKeyframes] = useState<CopiedKeyframeItem[]>([]);
  const [contextMenu, setContextMenu] = useState<
    | {
        /** Right-clicked an existing dot: offers copy (of the whole selection,
         * if the dot is part of one) and delete. */
        mode: "keyframe";
        x: number;
        y: number;
        kind: "bone" | "sprite";
        boneId: number;
        frame: number;
        slotId?: number;
      }
    | {
        /** Right-clicked empty space with something on the clipboard: offers
         * to paste it anchored at the cursor's frame. */
        mode: "paste";
        x: number;
        y: number;
        frame: number;
      }
    | null
  >(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [fpsInput, setFpsInput] = useState<string>("");
  const [durationInput, setDurationInput] = useState<string>("");
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [scrollOffsetX, setScrollOffsetX] = useState(0);

  const { mode, selectedBoneId, selectedBoneIds, selectBone } =
    useEditorStore();
  const timelineBoneKeys = useSkeletonStore(
    useShallow((state) =>
      state.bones.map((bone) =>
        [
          bone.id,
          bone.skinId,
          bone.name.replaceAll(TIMELINE_BONE_KEY_SEPARATOR, ""),
        ].join(TIMELINE_BONE_KEY_SEPARATOR),
      ),
    ),
  );
  const bones = useMemo<TimelineBone[]>(
    () =>
      timelineBoneKeys.map((key) => {
        const [id, skinId, name = ""] = key.split(TIMELINE_BONE_KEY_SEPARATOR);
        return {
          id: Number(id),
          skinId: Number(skinId),
          name,
        };
      }),
    [timelineBoneKeys],
  );
  const skins = useSkeletonStore((state) => state.skins);
  const { slots, attachments } = useSlotStore();
  const {
    deformerKeyframes,
    setDeformerKeyframe,
    deleteDeformerKeyframe,
    moveDeformerKeyframe,
    updateDeformerKeyframeEasing,
  } = useDeformerStore();
  const { captureSnapshot } = useHistoryStore();
  const {
    keyframes,
    slotAttachmentKeyframes,
    attachmentOpacityKeyframes,
    meshDeformKeyframes,
    frame,
    duration,
    fps,
    playing,
    audioTracks,
    activeAudioTrackId,
    setFrame,
    setDuration,
    setFps,
    addAudioTrack,
    removeAudioTrack,
    setActiveAudioTrackId,
    setAudioVolume,
    setAudioOffsetFrames,
    play,
    stop,
    applyKeyframes,
    getKeyframesForBone,
    insertKeyframe,
    deleteSlotAttachmentKeyframe,
    moveSlotAttachmentKeyframe,
    setAttachmentOpacityKeyframeAtFrame,
    updateKeyframeEasing,
    moveKeyframe,
    moveAttachmentOpacityKeyframe,
    updateAttachmentOpacityKeyframeEasing,
    setMeshDeformKeyframeAtFrame,
    deleteMeshDeformKeyframe,
    moveMeshDeformKeyframe,
    updateMeshDeformKeyframeEasing,
    deleteKeyframe,
    deleteAttachmentOpacityKeyframe,
    clearKeyframes,
  } = useAnimationStore();
  const activeAudioTrack =
    audioTracks.find((track) => track.id === activeAudioTrackId) ??
    audioTracks[0] ??
    null;
  const audioData = activeAudioTrack?.dataUrl ?? null;
  const audioName = activeAudioTrack?.name ?? null;
  const audioVolume = activeAudioTrack?.volume ?? 0.8;
  const audioOffsetFrames = activeAudioTrack?.offsetFrames ?? 0;
  const hasAudioTracks = audioTracks.length > 0;
  const audioTrackSourcesKey = useMemo(
    () =>
      audioTracks
        .map((track) => `${track.id}:${getAudioSourceKey(track.dataUrl)}`)
        .join("\n"),
    [audioTracks],
  );

  const deleteAttachmentOpacityKeysAtFrame = (
    boneId: number,
    targetFrame: number,
  ) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        deleteAttachmentOpacityKeyframe(
          getAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          }),
          targetFrame,
        );
      });
  };

  const getAttachmentKeysForBone = (boneId: number) =>
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .map((slot) =>
        getAttachmentKey({
          slotId: slot.id,
          name: slot.attachmentName!,
        }),
      );

  const getDeformerIdsForBone = (boneId: number) => {
    const slotIds = new Set(
      slots.filter((slot) => slot.boneId === boneId).map((slot) => slot.id),
    );
    return Array.from(
      new Set(
        attachments
          .filter(
            (attachment) =>
              slotIds.has(attachment.slotId) && attachment.deformerId != null,
          )
          .map((attachment) => attachment.deformerId!),
      ),
    );
  };

  const deleteMeshDeformKeysAtFrame = (
    boneId: number,
    targetFrame: number,
  ) => {
    getAttachmentKeysForBone(boneId).forEach((attachmentKey) => {
      deleteMeshDeformKeyframe(attachmentKey, targetFrame);
    });
  };

  const deleteDeformerKeysAtFrame = (
    boneId: number,
    targetFrame: number,
  ) => {
    getDeformerIdsForBone(boneId).forEach((deformerId) => {
      deleteDeformerKeyframe(deformerId, targetFrame);
    });
  };

  const deleteSpriteKeyAtFrame = (slotId: number, targetFrame: number) => {
    deleteSlotAttachmentKeyframe(slotId, targetFrame);
  };

  const clearSpriteKeysForBone = (boneId: number) => {
    slots
      .filter((slot) => slot.boneId === boneId)
      .forEach((slot) => {
        const frames = Object.keys(slotAttachmentKeyframes[slot.id] ?? {}).map(Number);
        frames.forEach((targetFrame) =>
          deleteSlotAttachmentKeyframe(slot.id, targetFrame),
        );
      });
  };

  const clearAttachmentOpacityKeysForBone = (boneId: number) => {
    slots
      .filter((slot) => slot.boneId === boneId && slot.attachmentName)
      .forEach((slot) => {
        if (!slot.attachmentName) return;
        const attachmentKey = getAttachmentKey({
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
    getAttachmentKeysForBone(boneId).forEach((attachmentKey) => {
      const meshFrames = Object.keys(
        meshDeformKeyframes[attachmentKey] ?? {},
      ).map(Number);
      meshFrames.forEach((targetFrame) =>
        deleteMeshDeformKeyframe(attachmentKey, targetFrame),
      );
    });
  };

  const clearDeformerKeysForBone = (boneId: number) => {
    getDeformerIdsForBone(boneId).forEach((deformerId) => {
      const deformerFrames = Object.keys(
        deformerKeyframes[deformerId] ?? {},
      ).map(Number);
      deformerFrames.forEach((targetFrame) =>
        deleteDeformerKeyframe(deformerId, targetFrame),
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
          getAttachmentKey({
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
    getAttachmentKeysForBone(boneId).forEach((attachmentKey) => {
      moveMeshDeformKeyframe(attachmentKey, fromFrame, toFrame);
    });
  };

  const moveDeformerKeysAtFrame = (
    boneId: number,
    fromFrame: number,
    toFrame: number,
  ) => {
    getDeformerIdsForBone(boneId).forEach((deformerId) => {
      moveDeformerKeyframe(deformerId, fromFrame, toFrame);
    });
  };

  const moveSpriteKeyAtFrame = (
    slotId: number,
    fromFrame: number,
    toFrame: number,
  ) => {
    moveSlotAttachmentKeyframe(slotId, fromFrame, toFrame);
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
          getAttachmentKey({
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
    getAttachmentKeysForBone(boneId).forEach((attachmentKey) => {
      updateMeshDeformKeyframeEasing(attachmentKey, targetFrame, easing);
    });
  };

  const updateDeformerEasingAtFrame = (
    boneId: number,
    targetFrame: number,
    easing: KeyframeEasing,
  ) => {
    getDeformerIdsForBone(boneId).forEach((deformerId) => {
      updateDeformerKeyframeEasing(deformerId, targetFrame, easing);
    });
  };

  const getSpriteSwapMarkersByBone = (): Record<number, SpriteSwapMarker[]> => {
    const spriteSwapMarkersByBone: Record<number, SpriteSwapMarker[]> = {};
    slots.forEach((slot) => {
      const keyframesForSlot = slotAttachmentKeyframes[slot.id];
      if (!keyframesForSlot) return;
      const markers = Object.entries(keyframesForSlot)
        .map(([frame, value]) => ({
          slotId: slot.id,
          frame: Number(frame),
          attachmentName: value.attachmentName,
        }))
        .sort((a, b) => a.frame - b.frame);
      if (markers.length === 0) return;
      spriteSwapMarkersByBone[slot.boneId] = [
        ...(spriteSwapMarkersByBone[slot.boneId] ?? []),
        ...markers,
      ];
    });

    Object.keys(spriteSwapMarkersByBone).forEach((boneId) => {
      spriteSwapMarkersByBone[Number(boneId)] = spriteSwapMarkersByBone[
        Number(boneId)
      ].sort((a, b) => a.frame - b.frame || a.slotId - b.slotId);
    });

    return spriteSwapMarkersByBone;
  };

  const getSpriteMarkersForBone = (boneId: number): TimelineMarker[] =>
    slots
      .filter((slot) => slot.boneId === boneId)
      .flatMap((slot) =>
        Object.keys(slotAttachmentKeyframes[slot.id] ?? {})
          .map(Number)
          .sort((a, b) => a - b)
          .map((spriteFrame) => ({
            kind: "sprite" as const,
            boneId,
            slotId: slot.id,
            frame: spriteFrame,
          })),
      );

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
      ? Math.max(10, parsed)
      : 10;
    captureSnapshot();
    setDuration(clamped);
    setDurationInput(String(clamped));
  };

  useEffect(() => {
    const refs = audioRefs.current;
    refs.forEach((audio) => audio.pause());
    refs.clear();

    audioTracks.forEach((track) => {
      const audio = new Audio(track.dataUrl);
      audio.preload = "auto";
      audio.volume = track.volume;
      refs.set(track.id, audio);
    });

    return () => {
      refs.forEach((audio) => audio.pause());
      refs.clear();
    };
  }, [audioTrackSourcesKey]);

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
    audioTracks.forEach((track) => {
      const audio = audioRefs.current.get(track.id);
      if (audio) audio.volume = track.volume;
    });
  }, [audioTracks]);

  useEffect(() => {
    if (playing) return;
    audioTracks.forEach((track) => {
      const audio = audioRefs.current.get(track.id);
      if (!audio) return;
      const timelineTime = getAudioTimelineTime(frame, fps, track.offsetFrames);
      const targetTime = clamp(timelineTime, 0, audio.duration || 0);
      if (Math.abs(audio.currentTime - targetTime) > 0.05) {
        audio.currentTime = targetTime;
      }
    });
  }, [frame, fps, playing, audioTracks]);

  useEffect(() => {
    if (playing && mode === "animate") {
      audioTracks.forEach((track) => {
        const audio = audioRefs.current.get(track.id);
        if (!audio) return;
        const timelineTime = getAudioTimelineTime(frame, fps, track.offsetFrames);

        if (!isAudioTimelineActive(timelineTime, audio.duration || 0)) {
          audio.pause();
          audio.currentTime = clamp(timelineTime, 0, audio.duration || 0);
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
      });
      wasPlayingRef.current = true;
      return;
    }

    audioRefs.current.forEach((audio) => audio.pause());
    wasPlayingRef.current = false;
  }, [playing, mode, frame, fps, audioTracks]);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth } = wrapRef.current;
      const audioRowH = hasAudioTracks ? AUDIO_ROW_H : 0;
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
  }, [bones.length, hasAudioTracks]);

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

    const spriteSwapFramesByBone = getSpriteSwapMarkersByBone();

    drawTimeline(
      ctx,
      bones,
      skins,
      keyframes,
      spriteSwapFramesByBone,
      selectedKeyframes,
      frame,
      duration,
      selectedBoneId,
      selectedBoneIds,
      {
        enabled: Boolean(activeAudioTrack),
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
    slotAttachmentKeyframes,
    selectedKeyframes,
    frame,
    duration,
    selectedBoneId,
    selectedBoneIds,
    resizeTick,
    activeAudioTrack,
    audioName,
    audioOffsetFrames,
    audioDurationSeconds,
    fps,
    waveformPeaks,
    slots,
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
      current.filter((marker) =>
        marker.kind === "bone"
          ? Boolean(keyframes[marker.boneId]?.[marker.frame])
          : typeof marker.slotId === "number"
            ? Boolean(slotAttachmentKeyframes[marker.slotId]?.[marker.frame])
            : false,
      ),
    );
  }, [keyframes, slotAttachmentKeyframes]);

  const maxPlaybackFrame = useMemo(() => {
    let maxKeyframe = 0;

    Object.values(keyframes).forEach((boneKeyframes) => {
      Object.keys(boneKeyframes).forEach((frameKey) => {
        maxKeyframe = Math.max(maxKeyframe, Number(frameKey));
      });
    });

    Object.values(slotAttachmentKeyframes).forEach((spriteKeyframes) => {
      Object.keys(spriteKeyframes).forEach((frameKey) => {
        maxKeyframe = Math.max(maxKeyframe, Number(frameKey));
      });
    });

    Object.values(attachmentOpacityKeyframes).forEach((opacityKeyframes) => {
      Object.keys(opacityKeyframes).forEach((frameKey) => {
        maxKeyframe = Math.max(maxKeyframe, Number(frameKey));
      });
    });

    Object.values(meshDeformKeyframes).forEach((meshKeyframes) => {
      Object.keys(meshKeyframes).forEach((frameKey) => {
        maxKeyframe = Math.max(maxKeyframe, Number(frameKey));
      });
    });

    Object.values(deformerKeyframes).forEach((deformerFrames) => {
      Object.keys(deformerFrames).forEach((frameKey) => {
        maxKeyframe = Math.max(maxKeyframe, Number(frameKey));
      });
    });

    return maxKeyframe > 0 ? maxKeyframe : duration;
  }, [
    duration,
    keyframes,
    slotAttachmentKeyframes,
    attachmentOpacityKeyframes,
    meshDeformKeyframes,
    deformerKeyframes,
  ]);

  useEffect(() => {
    if (!playing) return;

    const frameIntervalMs = 1000 / Math.max(1, fps);
    let animationFrameId = 0;
    let lastTimestamp: number | null = null;
    let accumulatedMs = 0;

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }

      accumulatedMs += timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      const elapsedFrames = Math.min(
        5,
        Math.floor(accumulatedMs / frameIntervalMs),
      );

      if (elapsedFrames > 0) {
        accumulatedMs -= elapsedFrames * frameIntervalMs;
        unstable_batchedUpdates(() => {
          const store = useAnimationStore.getState();
          let nextFrame = store.frame;

          for (let i = 0; i < elapsedFrames; i += 1) {
            nextFrame =
              nextFrame >= maxPlaybackFrame && maxPlaybackFrame > 0
                ? 0
                : nextFrame + 1;
          }

          store.setFrame(nextFrame);
          if (mode === "animate") {
            store.applyKeyframes();
          }
        });
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
  }, [playing, fps, maxPlaybackFrame, mode]);

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
  ): TimelineMarker | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const audioRowH = hasAudioTracks ? AUDIO_ROW_H : 0;
    const frameW = getFrameW(rect.width);

    if (sx < HEADER_W) return null;

    const boneIndex = Math.floor((sy - audioRowH) / ROW_H);
    if (boneIndex < 0 || boneIndex >= bones.length) return null;

    const bone = bones[boneIndex];
    const boneKeyframes = keyframes[bone.id];
    if (boneKeyframes) {
      for (const kf of Object.keys(boneKeyframes)) {
        const kfFrame = parseInt(kf);
        const kfX = HEADER_W + kfFrame * frameW - scrollOffsetX;
        const kfY = audioRowH + boneIndex * ROW_H + ROW_H / 2;

        const dist = Math.hypot(sx - kfX, sy - kfY);
        if (dist < 8) {
          return { kind: "bone", boneId: bone.id, frame: kfFrame };
        }
      }
    }

    const spriteMarkers = getSpriteSwapMarkersByBone()[bone.id] ?? [];
    for (const marker of spriteMarkers) {
      const markerX = HEADER_W + marker.frame * frameW - scrollOffsetX;
      const markerY = audioRowH + boneIndex * ROW_H + ROW_H - 7;
      if (
        sx >= markerX - 6 &&
        sx <= markerX + 6 &&
        sy >= markerY - 6 &&
        sy <= markerY + 6
      ) {
        return {
          kind: "sprite",
          boneId: bone.id,
          frame: marker.frame,
          slotId: marker.slotId,
        };
      }
    }

    return null;
  };

  const getBoneAtPosition = (sy: number) => {
    const audioRowH = hasAudioTracks ? AUDIO_ROW_H : 0;
    const boneIndex = Math.floor((sy - audioRowH) / ROW_H);

    if (boneIndex < 0 || boneIndex >= bones.length) return null;
    return bones[boneIndex] ?? null;
  };

  const isAudioTrackHit = (sy: number) =>
    hasAudioTracks && sy >= 0 && sy <= AUDIO_ROW_H;

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
        const spriteBadgeTop = (hasAudioTracks ? AUDIO_ROW_H : 0) + bones.findIndex((bone) => bone.id === boneHit.id) * ROW_H + ROW_H - 14;
        if (sy >= spriteBadgeTop) {
          const spriteMarkers = getSpriteMarkersForBone(boneHit.id);
          if (spriteMarkers.length > 0) {
            setSelectedKeyframes(spriteMarkers);
            return;
          }
        }

        const boneKeyframes = keyframes[boneHit.id];
        if (boneKeyframes) {
          const allFrames = Object.keys(boneKeyframes).map(Number);
          setSelectedKeyframes(
            allFrames.map((f) => ({
              kind: "bone",
              boneId: boneHit.id,
              frame: f,
            })),
          );
        }
        setSelectedKeyframes([]);
        return;
      }
    }

    if (e.detail === 2 && keyframeHit) {
      if (keyframeHit.kind === "bone") {
        deleteKeyframe(keyframeHit.boneId, keyframeHit.frame);
        deleteAttachmentOpacityKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
        deleteMeshDeformKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
        deleteDeformerKeysAtFrame(keyframeHit.boneId, keyframeHit.frame);
      } else if (typeof keyframeHit.slotId === "number") {
        deleteSpriteKeyAtFrame(keyframeHit.slotId, keyframeHit.frame);
      }
      return;
    }

    if (keyframeHit) {
      setSelectedKeyframes((current) => {
        const nextSelection = (() => {
          if (e.shiftKey) {
            const exists = current.some(
              (marker) => isSameTimelineMarker(marker, keyframeHit),
            );
            if (exists) {
              return current.filter((marker) => !isSameTimelineMarker(marker, keyframeHit));
            }
            return [...current, keyframeHit];
          }

          const alreadySelected = current.some(
            (marker) => isSameTimelineMarker(marker, keyframeHit),
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

    if (isAudioTrackHit(sy) && sx > HEADER_W && hasAudioTracks) {
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

    if (isDragging && dragMode === "audio-offset" && hasAudioTracks) {
      setAudioOffsetFrames(getFrameFromX(sx, rect.width));
      return;
    }

    const keyframeHit = getKeyframeAtPosition(sx, sy);
    setHoveredKeyframe(keyframeHit);

    if (!isDragging) return;

    if (dragMode === "keyframe" && draggedKeyframe) {
      const newFrame = getFrameFromX(sx, rect.width);
      if (newFrame !== draggedKeyframe.frame) {
        const delta = newFrame - draggedKeyframe.frame;
        const activeSelection =
          draggedKeyframeSelection.length > 0
            ? draggedKeyframeSelection
            : [draggedKeyframe];

        activeSelection.forEach((keyframe) => {
          if (keyframe.kind === "bone") {
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
            moveDeformerKeysAtFrame(
              keyframe.boneId,
              keyframe.frame,
              keyframe.frame + delta,
            );
          } else if (typeof keyframe.slotId === "number") {
            moveSpriteKeyAtFrame(keyframe.slotId, keyframe.frame, keyframe.frame + delta);
          }
        });

        setDraggedKeyframeSelection((current) =>
          current.map((keyframe) => ({
            kind: keyframe.kind,
            boneId: keyframe.boneId,
            frame: keyframe.frame + delta,
            ...(keyframe.slotId !== undefined ? { slotId: keyframe.slotId } : {}),
          })),
        );
        setSelectedKeyframes((current) =>
          current.map((keyframe) => ({
            kind: keyframe.kind,
            boneId: keyframe.boneId,
            frame: keyframe.frame + delta,
            ...(keyframe.slotId !== undefined ? { slotId: keyframe.slotId } : {}),
          })),
        );
        setDraggedKeyframe({
          kind: draggedKeyframe.kind,
          boneId: draggedKeyframe.boneId,
          frame: newFrame,
          ...(draggedKeyframe.slotId !== undefined
            ? { slotId: draggedKeyframe.slotId }
            : {}),
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
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        mode: "keyframe",
        kind: keyframeHit.kind,
        boneId: keyframeHit.boneId,
        frame: keyframeHit.frame,
        slotId: keyframeHit.slotId,
      });
      return;
    }

    // Nothing under the cursor: offer to paste, as long as the click still
    // lands on a bone row. Each clipboard item already knows its own bone, so
    // — unlike the single-item version of this feature — the row clicked only
    // supplies the target frame, not the target bone.
    const boneAtCursor = getBoneAtPosition(sy);
    if (copiedKeyframes.length > 0 && boneAtCursor) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        mode: "paste",
        frame: getFrameFromX(sx, rect.width),
      });
    }
  };

  const handleDeleteFromContextMenu = () => {
    if (contextMenu && contextMenu.mode === "keyframe") {
      if (contextMenu.kind === "bone") {
        deleteKeyframe(contextMenu.boneId, contextMenu.frame);
        deleteAttachmentOpacityKeysAtFrame(contextMenu.boneId, contextMenu.frame);
        deleteMeshDeformKeysAtFrame(contextMenu.boneId, contextMenu.frame);
        deleteDeformerKeysAtFrame(contextMenu.boneId, contextMenu.frame);
      } else if (typeof contextMenu.slotId === "number") {
        deleteSpriteKeyAtFrame(contextMenu.slotId, contextMenu.frame);
      }
      setContextMenu(null);
    }
  };

  /** Snapshot everything tied to one marker's source frame, in clipboard form. */
  const captureKeyframeItem = (marker: TimelineMarker): CopiedKeyframeItem | null => {
    if (marker.kind === "sprite") {
      if (typeof marker.slotId !== "number") return null;
      const attachmentName =
        slotAttachmentKeyframes[marker.slotId]?.[marker.frame]?.attachmentName ?? null;
      return {
        kind: "sprite",
        boneId: marker.boneId,
        slotId: marker.slotId,
        sourceFrame: marker.frame,
        attachmentName,
      };
    }

    const boneKeyframe = keyframes[marker.boneId]?.[marker.frame];
    if (!boneKeyframe) return null;

    const sprites: CopiedBoneKeyframe["sprites"] = [];
    const opacities: CopiedBoneKeyframe["opacities"] = [];
    const meshes: CopiedBoneKeyframe["meshes"] = [];

    slots
      .filter((slot) => slot.boneId === marker.boneId)
      .forEach((slot) => {
        const spriteKeyframe = slotAttachmentKeyframes[slot.id]?.[marker.frame];
        if (spriteKeyframe) {
          sprites.push({ slotId: slot.id, attachmentName: spriteKeyframe.attachmentName });
        }

        if (!slot.attachmentName) return;
        const attachmentKey = getAttachmentKey({ slotId: slot.id, name: slot.attachmentName });

        const opacityKeyframe = attachmentOpacityKeyframes[attachmentKey]?.[marker.frame];
        if (opacityKeyframe) {
          opacities.push({
            attachmentKey,
            opacity: opacityKeyframe.opacity,
            easing: opacityKeyframe.easing,
          });
        }

        const meshKeyframe = meshDeformKeyframes[attachmentKey]?.[marker.frame];
        if (meshKeyframe) {
          meshes.push({ attachmentKey, vertices: meshKeyframe.vertices, easing: meshKeyframe.easing });
        }
      });

    return {
      kind: "bone",
      boneId: marker.boneId,
      sourceFrame: marker.frame,
      bone: { ...boneKeyframe },
      sprites,
      opacities,
      meshes,
    };
  };

  const handleCopyKeyframe = () => {
    if (!contextMenu || contextMenu.mode !== "keyframe") return;
    const clicked: TimelineMarker = {
      kind: contextMenu.kind,
      boneId: contextMenu.boneId,
      frame: contextMenu.frame,
      slotId: contextMenu.slotId,
    };

    // Right-clicking a dot that is part of the active multi-selection copies
    // the whole selection; right-clicking any other dot copies just that one,
    // the way most apps treat a right-click on an unselected item.
    const isPartOfSelection = selectedKeyframes.some((marker) =>
      isSameTimelineMarker(marker, clicked),
    );
    const markersToCopy = isPartOfSelection ? selectedKeyframes : [clicked];

    const items = markersToCopy
      .map(captureKeyframeItem)
      .filter((item): item is CopiedKeyframeItem => item !== null);

    setCopiedKeyframes(items);
    setContextMenu(null);
  };

  const handlePasteKeyframe = () => {
    if (!contextMenu || contextMenu.mode !== "paste" || copiedKeyframes.length === 0) return;

    // The group moves as one: every item shifts by the same offset, measured
    // from the earliest source frame in the copy to the frame under the
    // cursor. Pasting a single item is the offset===target-source case, so
    // this subsumes the old single-keyframe paste exactly.
    const anchorFrame = Math.min(...copiedKeyframes.map((item) => item.sourceFrame));
    const pasteFrame = contextMenu.frame;
    const offset = pasteFrame - anchorFrame;

    captureSnapshot();

    copiedKeyframes.forEach((item) => {
      const targetFrame = Math.min(duration, Math.max(0, item.sourceFrame + offset));

      if (item.kind === "sprite") {
        useAnimationStore
          .getState()
          .setSlotAttachmentKeyframeAtFrame(item.slotId, targetFrame, item.attachmentName);
        return;
      }

      // `insertKeyframe` writes at the current playhead frame rather than an
      // explicit one, so the playhead moves to each target first — the same
      // trick `handleLoopKeyframes` uses for the identical reason.
      setFrame(targetFrame);
      insertKeyframe(item.boneId, { ...item.bone });

      item.sprites.forEach(({ slotId, attachmentName }) => {
        useAnimationStore
          .getState()
          .setSlotAttachmentKeyframeAtFrame(slotId, targetFrame, attachmentName);
      });
      item.opacities.forEach(({ attachmentKey, opacity, easing }) => {
        setAttachmentOpacityKeyframeAtFrame(attachmentKey, targetFrame, opacity);
        updateAttachmentOpacityKeyframeEasing(
          attachmentKey,
          targetFrame,
          normalizeKeyframeEasing(easing),
        );
      });
      item.meshes.forEach(({ attachmentKey, vertices, easing }) => {
        setMeshDeformKeyframeAtFrame(attachmentKey, targetFrame, vertices);
        updateMeshDeformKeyframeEasing(
          attachmentKey,
          targetFrame,
          normalizeKeyframeEasing(easing),
        );
      });
    });

    if (mode === "animate") applyKeyframes();
    setFrame(pasteFrame);
    setContextMenu(null);
  };

  const contextMenuLabel =
    contextMenu?.mode === "keyframe" && contextMenu.kind === "sprite"
      ? "Delete Sprite Key"
      : "Delete Keyframe";
  const contextMenuTargetsSelection =
    contextMenu?.mode === "keyframe" &&
    selectedKeyframes.length > 1 &&
    selectedKeyframes.some((marker) =>
      isSameTimelineMarker(marker, {
        kind: contextMenu.kind,
        boneId: contextMenu.boneId,
        frame: contextMenu.frame,
        slotId: contextMenu.slotId,
      }),
    );
  const copyMenuLabel = contextMenuTargetsSelection
    ? `Copy ${selectedKeyframes.length} Keyframes`
    : contextMenu?.mode === "keyframe" && contextMenu.kind === "sprite"
      ? "Copy Sprite Key"
      : "Copy Keyframe";
  const pasteMenuLabel =
    copiedKeyframes.length > 1
      ? `Paste ${copiedKeyframes.length} Keyframes`
      : copiedKeyframes[0]?.kind === "sprite"
        ? "Paste Sprite Key"
        : "Paste Keyframe";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedKeyframes.length > 0
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        captureSnapshot();
        selectedKeyframes.forEach((keyframe) => {
          if (keyframe.kind === "bone") {
            deleteKeyframe(keyframe.boneId, keyframe.frame);
            deleteAttachmentOpacityKeysAtFrame(keyframe.boneId, keyframe.frame);
            deleteMeshDeformKeysAtFrame(keyframe.boneId, keyframe.frame);
            deleteDeformerKeysAtFrame(keyframe.boneId, keyframe.frame);
          } else if (typeof keyframe.slotId === "number") {
            deleteSpriteKeyAtFrame(keyframe.slotId, keyframe.frame);
          }
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
        if (hoveredKeyframe.kind === "bone") {
          deleteKeyframe(hoveredKeyframe.boneId, hoveredKeyframe.frame);
          deleteAttachmentOpacityKeysAtFrame(
            hoveredKeyframe.boneId,
            hoveredKeyframe.frame,
          );
          deleteMeshDeformKeysAtFrame(
            hoveredKeyframe.boneId,
            hoveredKeyframe.frame,
          );
          deleteDeformerKeysAtFrame(
            hoveredKeyframe.boneId,
            hoveredKeyframe.frame,
          );
        } else if (typeof hoveredKeyframe.slotId === "number") {
          deleteSpriteKeyAtFrame(hoveredKeyframe.slotId, hoveredKeyframe.frame);
        }
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
    hoveredKeyframe,
    selectedKeyframes,
    captureSnapshot,
    deleteKeyframe,
    slots,
    attachmentOpacityKeyframes,
    meshDeformKeyframes,
    deformerKeyframes,
    deleteAttachmentOpacityKeyframe,
    deleteMeshDeformKeyframe,
    deleteDeformerKeyframe,
  ]);

  const handlePrevKey = () => {
    if (selectedBoneId === null) return;
    const keys = [
      ...getKeyframesForBone(selectedBoneId),
      ...slots
        .filter((slot) => slot.boneId === selectedBoneId)
        .flatMap((slot) => Object.keys(slotAttachmentKeyframes[slot.id] ?? {}).map(Number)),
      ...getAttachmentKeysForBone(selectedBoneId).flatMap((attachmentKey) =>
        Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number),
      ),
      ...getDeformerIdsForBone(selectedBoneId).flatMap((deformerId) =>
        Object.keys(deformerKeyframes[deformerId] ?? {}).map(Number),
      ),
    ].sort((a, b) => a - b);
    const prev = keys.filter((k) => k < frame).pop();
    if (prev !== undefined) {
      setFrame(prev);
      applyKeyframes();
    }
  };

  const handleNextKey = () => {
    if (selectedBoneId === null) return;
    const keys = [
      ...getKeyframesForBone(selectedBoneId),
      ...slots
        .filter((slot) => slot.boneId === selectedBoneId)
        .flatMap((slot) => Object.keys(slotAttachmentKeyframes[slot.id] ?? {}).map(Number)),
      ...getAttachmentKeysForBone(selectedBoneId).flatMap((attachmentKey) =>
        Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number),
      ),
      ...getDeformerIdsForBone(selectedBoneId).flatMap((deformerId) =>
        Object.keys(deformerKeyframes[deformerId] ?? {}).map(Number),
      ),
    ].sort((a, b) => a - b);
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
    audioRefs.current.forEach((audio) => {
      audio.currentTime = 0;
    });
  };

  const handleInsertKeyframe = () => {
    if (selectedBoneIds.length === 0) return;

    const currentBones = useSkeletonStore.getState().bones;
    captureSnapshot();
    selectedBoneIds.forEach((boneId) => {
      const bone = currentBones.find((item) => item.id === boneId);
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
      clearSpriteKeysForBone(boneId);
      clearAttachmentOpacityKeysForBone(boneId);
      clearMeshDeformKeysForBone(boneId);
      clearDeformerKeysForBone(boneId);
    });
    setSelectedKeyframes([]);
  };

  const handleLoopKeyframes = () => {
    if (mode !== "animate") return;

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
          getAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName!,
          }),
        );

      return [
        ...slots
          .filter((slot) => slot.boneId === boneId)
          .flatMap((slot) =>
            Object.keys(animState.slotAttachmentKeyframes[slot.id] ?? {}).map(Number),
          ),
        ...slotAttachmentKeys.flatMap((attachmentKey) =>
          Object.keys(animState.attachmentOpacityKeyframes[attachmentKey] ?? {}).map(Number),
        ),
        ...slotAttachmentKeys.flatMap((attachmentKey) =>
          Object.keys(animState.meshDeformKeyframes[attachmentKey] ?? {}).map(Number),
        ),
        ...getDeformerIdsForBone(boneId).flatMap((deformerId) =>
          Object.keys(deformerKeyframes[deformerId] ?? {}).map(Number),
        ),
      ];
    });

    const loopFrames = [...visibleBoneFrames, ...allAttachmentFrames];
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

          const attachmentKey = getAttachmentKey({
            slotId: slot.id,
            name: slot.attachmentName,
          });

          const spriteFrames = Object.keys(
            slotAttachmentKeyframes[slot.id] ?? {},
          )
            .map(Number)
            .sort((a, b) => a - b);

          if (spriteFrames.length >= 2) {
            const reversed = spriteFrames
              .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
              .reverse();

            reversed.forEach((srcFrame) => {
              const source = slotAttachmentKeyframes[slot.id]?.[srcFrame];
              if (!source) return;
              const destFrame = loopEnd + (loopEnd - srcFrame);
              deleteSlotAttachmentKeyframe(slot.id, destFrame);
              useAnimationStore
                .getState()
                .setSlotAttachmentKeyframeAtFrame(
                  slot.id,
                  destFrame,
                  source.attachmentName,
                );
            });
          }

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

          const meshFrames = Object.keys(
            animState.meshDeformKeyframes[attachmentKey] ?? {},
          )
            .map(Number)
            .sort((a, b) => a - b);

          if (meshFrames.length >= 2) {
            const reversed = meshFrames
              .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
              .reverse();

            reversed.forEach((srcFrame) => {
              const source = animState.meshDeformKeyframes[attachmentKey]?.[srcFrame];
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

      getDeformerIdsForBone(boneId).forEach((deformerId) => {
        const deformerFrames = Object.keys(deformerKeyframes[deformerId] ?? {})
          .map(Number)
          .sort((a, b) => a - b);

        if (deformerFrames.length < 2) return;

        const reversed = deformerFrames
          .filter((srcFrame) => srcFrame >= loopStart && srcFrame < loopEnd)
          .reverse();

        reversed.forEach((srcFrame) => {
          const source = deformerKeyframes[deformerId]?.[srcFrame];
          if (!source) return;
          const destFrame = loopEnd + (loopEnd - srcFrame);
          setDeformerKeyframe(deformerId, destFrame, source.points);
          updateDeformerKeyframeEasing(
            deformerId,
            destFrame,
            normalizeKeyframeEasing(source.easing),
          );
        });
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
        const spriteFrames = Object.keys(slotAttachmentKeyframes[slot.id] ?? {})
          .map(Number)
          .sort((a, b) => a - b);
        if (spriteFrames.length > 0) {
          const firstSpriteFrame = spriteFrames[0];
          const firstSpriteKey =
            slotAttachmentKeyframes[slot.id]?.[firstSpriteFrame];
          if (firstSpriteKey) {
            useAnimationStore
              .getState()
              .setSlotAttachmentKeyframeAtFrame(
                slot.id,
                frame,
                firstSpriteKey.attachmentName,
              );
          }
        }

        if (!slot.attachmentName) return;

        const attachmentKey = getAttachmentKey({
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

        const meshFrames = Object.keys(
          animState.meshDeformKeyframes[attachmentKey] ?? {},
        )
          .map(Number)
          .sort((a, b) => a - b);
        if (meshFrames.length > 0) {
          const firstMeshFrame = meshFrames[0];
          const firstMeshKey =
            animState.meshDeformKeyframes[attachmentKey]?.[firstMeshFrame];
          if (firstMeshKey) {
            setMeshDeformKeyframeAtFrame(
              attachmentKey,
              frame,
              firstMeshKey.vertices,
            );
            updateMeshDeformKeyframeEasing(
              attachmentKey,
              frame,
              normalizeKeyframeEasing(firstMeshKey.easing),
            );
          }
        }

      });
  };

  const handleSelectFrameKeyframes = () => {
    const frameKeyframes: TimelineMarker[] = bones.flatMap((bone) =>
      Object.keys(keyframes[bone.id] ?? {})
        .filter((keyframeFrame) => Number(keyframeFrame) === frame)
        .map((keyframeFrame) => ({
          kind: "bone" as const,
          boneId: bone.id,
          frame: Number(keyframeFrame),
        })),
    );

    const spriteFrameKeyframes: TimelineMarker[] = slots.flatMap((slot) =>
      Object.keys(slotAttachmentKeyframes[slot.id] ?? {})
        .filter((keyframeFrame) => Number(keyframeFrame) === frame)
        .map((keyframeFrame) => ({
          kind: "sprite" as const,
          boneId: slot.boneId,
          slotId: slot.id,
          frame: Number(keyframeFrame),
        })),
    );

    setSelectedKeyframes([...frameKeyframes, ...spriteFrameKeyframes]);
  };

  const handleAudioImport = async () => {
    try {
      const audioFile = await openAudioFile({ filters: AUDIO_FILTERS });
      if (!audioFile) return;
      addAudioTrack(audioFile.dataUrl, audioFile.name);
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
            .filter((marker) => marker.kind === "bone")
            .map(
              ({ boneId, frame: keyframeFrame }) =>
                keyframes[boneId]?.[keyframeFrame]?.easing,
            )
            .filter(Boolean)
            .map((value) => normalizeKeyframeEasing(value));

          if (values.length === 0) return "";
          const first = values[0];
          return values.every((value) => value === first) ? first : "";
        })();

  const hasAnyAnimationData =
    Object.keys(keyframes).length > 0 ||
    Object.keys(slotAttachmentKeyframes).length > 0 ||
    Object.keys(attachmentOpacityKeyframes).length > 0 ||
    Object.keys(meshDeformKeyframes).length > 0 ||
    Object.keys(deformerKeyframes).length > 0;

  const handleEasingChange = (value: string) => {
    if (!value || selectedKeyframes.length === 0) return;

    captureSnapshot();
    selectedKeyframes.forEach(({ kind, boneId, frame: keyframeFrame }) => {
      if (kind !== "bone") return;
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
      updateDeformerEasingAtFrame(
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
          disabled={mode !== "animate" || !hasAnyAnimationData}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-accent hover:border-accent transition-all text-[10px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
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
          title="Select all transform and sprite keys at current frame"
        >
          Select Frame Keys
        </button>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/60 bg-panel2">
          <span className="inline-block w-3 h-1.5 rounded-sm bg-cyan-400" />
          <span className="text-[10px] text-text-dim">Sprite</span>
        </div>
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
          onClick={() => removeAudioTrack()}
          disabled={!hasAudioTracks}
          className="px-2 py-0.5 rounded border border-border bg-transparent text-text hover:bg-red-500 hover:border-red-500 transition-all text-xs disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border"
          title="Remove selected audio"
        >
          <X size={12} />
        </button>
        {hasAudioTracks ? (
          <select
            value={activeAudioTrack?.id ?? ""}
            onChange={(e) => setActiveAudioTrackId(Number(e.target.value))}
            className="max-w-[180px] bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[10px]"
            title="Select audio track"
          >
            {audioTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="max-w-[160px] truncate text-[10px] text-text-dim">
            No audio
          </span>
        )}
        {activeAudioTrack && (
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
          disabled={!activeAudioTrack}
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
          className="w-16 bg-panel2 border border-border rounded px-1 py-0.5 text-text text-[11px] text-center"
          min="10"
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
            {contextMenu.mode === "keyframe" ? (
              <>
                <button
                  onClick={handleCopyKeyframe}
                  className="w-full px-4 py-1.5 text-left text-[11px] text-text hover:bg-accent hover:text-white transition-colors"
                >
                  {copyMenuLabel}
                </button>
                <button
                  onClick={handleDeleteFromContextMenu}
                  className="w-full px-4 py-1.5 text-left text-[11px] text-text hover:bg-accent hover:text-white transition-colors"
                >
                  {contextMenuLabel}
                </button>
              </>
            ) : (
              <button
                onClick={handlePasteKeyframe}
                className="w-full px-4 py-1.5 text-left text-[11px] text-text hover:bg-accent hover:text-white transition-colors"
              >
                {pasteMenuLabel}
              </button>
            )}
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
