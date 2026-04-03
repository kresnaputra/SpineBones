import type { Bone, KeyframeData, KeyframeEasing, Keyframes } from '../types';

export type IdlePresetId = 'calmBreathing' | 'vnSpeaking';

type BoneRole = 'body' | 'head' | 'arm' | 'hand' | 'hair' | 'leg' | 'other';
type BoneSide = 'left' | 'right' | 'center';

type IdlePresetDefinition = {
  label: string;
  description: string;
  duration: number;
  frames: number[];
  applyToBone: (
    role: BoneRole,
    base: KeyframeData,
    frame: number,
    duration: number,
  ) => KeyframeData;
};

type PromptIntent = {
  breathing: number;
  hairSway: number;
  handSway: number;
  headBob: number;
  speaking: number;
  duration: number;
  styleLabel: string;
};

const BODY_MATCHERS = ['body', 'torso', 'chest', 'spine', 'pinggang', 'badan'];
const HEAD_MATCHERS = ['head', 'kepala', 'face', 'neck', 'leher'];
const ARM_MATCHERS = ['arm', 'lengan', 'shoulder', 'bahu'];
const HAND_MATCHERS = ['hand', 'tangan', 'wrist', 'palm'];
const HAIR_MATCHERS = ['hair', 'rambut', 'bangs', 'ponytail'];
const LEG_MATCHERS = ['leg', 'kaki', 'foot', 'feet', 'paw', 'boot', 'shin', 'calf', 'thigh'];

const CALM_FRAMES = [0, 35, 70, 105, 140];
const VN_FRAMES = [0, 24, 48, 72, 96, 120, 140];

const includesAny = (value: string, keywords: string[]) =>
  keywords.some((keyword) => value.includes(keyword));

const detectBoneRole = (bone: Bone): BoneRole => {
  const name = bone.name.toLowerCase();

  if (includesAny(name, BODY_MATCHERS)) return 'body';
  if (includesAny(name, HEAD_MATCHERS)) return 'head';
  if (includesAny(name, HAND_MATCHERS)) return 'hand';
  if (includesAny(name, ARM_MATCHERS)) return 'arm';
  if (includesAny(name, HAIR_MATCHERS)) return 'hair';
  if (includesAny(name, LEG_MATCHERS)) return 'leg';
  return 'other';
};

const detectBoneSide = (bone: Bone): BoneSide => {
  const name = bone.name.toLowerCase();
  if (includesAny(name, ['left', 'kiri', '_l', '-l', '.l'])) return 'left';
  if (includesAny(name, ['right', 'kanan', '_r', '-r', '.r'])) return 'right';
  return 'center';
};

const makePose = (
  base: KeyframeData,
  updates: Partial<KeyframeData>,
): KeyframeData => ({
  x: updates.x ?? base.x,
  y: updates.y ?? base.y,
  rotation: updates.rotation ?? base.rotation,
  scaleX: updates.scaleX ?? base.scaleX,
  scaleY: updates.scaleY ?? base.scaleY,
  easing: updates.easing ?? 'easeInOut',
});

const IDLE_PRESETS: Record<IdlePresetId, IdlePresetDefinition> = {
  calmBreathing: {
    label: 'Calm Breathing',
    description: 'Slow visual-novel style breathing with tiny head and hand motion.',
    duration: 140,
    frames: CALM_FRAMES,
    applyToBone: (role, base, frame) => {
      const phaseMap: Record<number, number> = {
        0: 0,
        35: 1,
        70: 0.35,
        105: 1.1,
        140: 0,
      };
      const phase = phaseMap[frame] ?? 0;

      switch (role) {
        case 'body':
          return makePose(base, {
            y: base.y - 6 * phase,
            scaleX: base.scaleX + 0.006 * phase,
            scaleY: base.scaleY + 0.02 * phase,
          });
        case 'head':
          return makePose(base, {
            y: base.y - 4 * phase,
            rotation: base.rotation + (frame === 105 ? -0.5 : 0.7 * phase),
          });
        case 'arm':
          return makePose(base, {
            y: base.y + 2.5 * phase,
            rotation: base.rotation + 1.8 * phase,
          });
        case 'hand':
          return makePose(base, {
            y: base.y + 4 * phase,
            rotation: base.rotation + 2.8 * phase,
          });
        case 'hair':
          return makePose(base, {
            y: base.y - 3 * phase,
            rotation: base.rotation + (frame === 105 ? 1.0 : -1.2 * phase),
          });
        case 'leg':
          return makePose(base, {
            y: base.y + 2.8 * phase,
            rotation: base.rotation - 2.4 * phase,
          });
        default:
          return makePose(base, {
            y: base.y - 1.5 * phase,
          });
      }
    },
  },
  vnSpeaking: {
    label: 'VN Speaking',
    description: 'A slightly more alive idle for dialogue scenes with shoulder sway.',
    duration: 140,
    frames: VN_FRAMES,
    applyToBone: (role, base, frame, duration) => {
      const wave = Math.sin((frame / duration) * Math.PI * 2);
      const lift = Math.max(0, wave);

      switch (role) {
        case 'body':
          return makePose(base, {
            y: base.y - 4 * lift,
            scaleX: base.scaleX + 0.004 * lift,
            scaleY: base.scaleY + 0.014 * lift,
            rotation: base.rotation + 0.25 * wave,
          });
        case 'head':
          return makePose(base, {
            y: base.y - 2 * lift,
            rotation: base.rotation + 1.2 * wave,
          });
        case 'arm':
          return makePose(base, {
            y: base.y + 2 * lift,
            rotation: base.rotation + 2.4 * wave,
          });
        case 'hand':
          return makePose(base, {
            y: base.y + 3.2 * lift,
            rotation: base.rotation + 4.2 * wave,
          });
        case 'hair':
          return makePose(base, {
            y: base.y - 2 * lift,
            rotation: base.rotation - 2.6 * wave,
          });
        case 'leg':
          return makePose(base, {
            y: base.y + 2.4 * lift,
            rotation: base.rotation - 2.2 * wave,
          });
        default:
          return makePose(base, {
            rotation: base.rotation + 0.3 * wave,
          });
      }
    },
  },
};

const getBaseKeyframe = (bone: Bone, existingBoneKeyframes: Record<number, KeyframeData> | undefined) => {
  const keyframeAtZero = existingBoneKeyframes?.[0];
  if (keyframeAtZero) {
    return {
      x: keyframeAtZero.x,
      y: keyframeAtZero.y,
      rotation: keyframeAtZero.rotation,
      scaleX: keyframeAtZero.scaleX,
      scaleY: keyframeAtZero.scaleY,
      easing: (keyframeAtZero.easing ?? 'linear') as KeyframeEasing,
    };
  }

  return {
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    easing: 'linear' as KeyframeEasing,
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const parsePromptEasing = (normalizedPrompt: string): KeyframeEasing | null => {
  if (
    includesAny(normalizedPrompt, [
      'ease in-out',
      'ease in out',
      'in-out',
      'in out',
      'easeinout',
    ])
  ) {
    return 'easeInOut';
  }

  if (includesAny(normalizedPrompt, ['ease out', 'ease-out', 'easeout', 'slow out'])) {
    return 'easeOut';
  }

  if (includesAny(normalizedPrompt, ['ease in', 'ease-in', 'easein', 'slow in'])) {
    return 'easeIn';
  }

  if (includesAny(normalizedPrompt, ['linear', 'linier'])) {
    return 'linear';
  }

  return null;
};

const analyzePrompt = (prompt: string): PromptIntent => {
  const normalized = prompt.toLowerCase().trim();

  const isSlow =
    includesAny(normalized, ['pelan', 'slow', 'calm', 'tenang', 'subtle', 'halus']) ||
    (!normalized && true);
  const isBig =
    includesAny(normalized, ['besar', 'dramatic', 'lebih hidup', 'kuat', 'intense', 'lebih kuat']);
  const wantsHair =
    includesAny(normalized, ['rambut', 'hair', 'ponytail', 'bangs', 'sway']);
  const wantsHand =
    includesAny(normalized, ['tangan', 'hand', 'arm', 'lengan', 'bahu', 'shoulder']);
  const wantsHead =
    includesAny(normalized, ['kepala', 'head', 'nod', 'face', 'wajah']);
  const wantsSpeaking =
    includesAny(normalized, ['bicara', 'speaking', 'talking', 'dialog', 'ngomong', 'speak']);
  const wantsLongLoop =
    includesAny(normalized, ['lama', 'panjang', 'long']) && !includesAny(normalized, ['pendek', 'short']);
  const wantsShortLoop =
    includesAny(normalized, ['pendek', 'short', 'quick']);

  let breathing = 1;
  if (isSlow) breathing *= 0.8;
  if (isBig) breathing *= 1.35;

  return {
    breathing: clamp(breathing, 0.45, 1.6),
    hairSway: wantsHair ? (isBig ? 1.25 : 0.9) : 0.45,
    handSway: wantsHand ? (isBig ? 1.2 : 0.85) : 0.55,
    headBob: wantsHead ? (isBig ? 1.15 : 0.8) : 0.55,
    speaking: wantsSpeaking ? 1 : 0,
    duration: wantsShortLoop ? 96 : wantsLongLoop ? 180 : 140,
    styleLabel: wantsSpeaking ? 'Prompt Speaking Idle' : 'Prompt Calm Idle',
  };
};

const getPromptFrames = (duration: number) => {
  const half = Math.round(duration * 0.25);
  const mid = Math.round(duration * 0.5);
  const threeQuarter = Math.round(duration * 0.75);
  return [0, half, mid, threeQuarter, duration];
};

const isAttackPrompt = (prompt: string) =>
  includesAny(prompt.toLowerCase(), [
    'attack',
    'slash',
    'hit',
    'punch',
    'jab',
    'swing',
    'serang',
    'tebas',
    'pukul',
  ]);

const isRunPrompt = (prompt: string) =>
  includesAny(prompt.toLowerCase(), ['run', 'lari', 'sprint', 'jog']);

const isWalkPrompt = (prompt: string) =>
  includesAny(prompt.toLowerCase(), ['walk', 'jalan', 'stroll']);

const isJumpPrompt = (prompt: string) =>
  includesAny(prompt.toLowerCase(), ['jump', 'lompat', 'hop', 'leap']);

const isLandPrompt = (prompt: string) =>
  includesAny(prompt.toLowerCase(), ['land', 'landing', 'mendarat']);

const getAttackFrames = (duration: number) => {
  const windup = Math.round(duration * 0.22);
  const strike = Math.round(duration * 0.42);
  const follow = Math.round(duration * 0.62);
  return [0, windup, strike, follow, duration];
};

const clampDuration = (value: number) => clamp(Math.round(value), 24, 300);

const parseExplicitDuration = (prompt: string): number | null => {
  const normalized = prompt.toLowerCase();
  const durationMatch =
    normalized.match(/duration\s+(\d{2,3})/) ??
    normalized.match(/(\d{2,3})\s*(frames?|frame)\b/);

  if (!durationMatch) return null;

  const value = Number.parseInt(durationMatch[1], 10);
  if (Number.isNaN(value)) return null;
  return clampDuration(value);
};

const applyAttackPromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
): { keyframes: Keyframes; duration: number; summary: string } => {
  const normalized = prompt.toLowerCase();
  const easing = parsePromptEasing(normalized) ?? 'easeInOut';
  const fast = includesAny(normalized, ['fast', 'cepat', 'quick']);
  const heavy = includesAny(normalized, ['heavy', 'kuat', 'strong', 'keras']);
  const slow = includesAny(normalized, ['slow', 'pelan', 'dramatic', 'cinematic']);
  const leftAttack = includesAny(normalized, ['left', 'kiri']);
  const rightAttack = includesAny(normalized, ['right', 'kanan']);
  const explicitDuration = parseExplicitDuration(prompt);
  const duration = explicitDuration ?? clampDuration(fast ? 72 : heavy ? 108 : slow ? 132 : 96);
  const frames = getAttackFrames(duration);
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));
  const attackSide: BoneSide = leftAttack ? 'left' : rightAttack ? 'right' : 'right';
  const direction = attackSide === 'left' ? -1 : 1;

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const side = detectBoneSide(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    frames.forEach((frame) => {
      const t = frame / duration;
      const swing = t <= 0.42 ? t / 0.42 : 1 - (t - 0.42) / 0.58;
      const windup = frame === frames[1] ? 1 : 0;
      const strike = frame === frames[2] ? 1 : 0;
      const recovery = frame === frames[3] ? 1 : 0;

      switch (role) {
        case 'body':
          generatedFrames[frame] = makePose(base, {
            x: base.x - 10 * direction * windup + 14 * direction * strike - 4 * direction * recovery,
            y: base.y - 4 * strike,
            rotation: base.rotation - 6 * direction * windup + 8 * direction * strike - 2 * direction * recovery,
            easing,
          });
          break;
        case 'head':
          generatedFrames[frame] = makePose(base, {
            x: base.x - 4 * direction * windup + 6 * direction * strike,
            rotation: base.rotation - 3 * direction * windup + 4 * direction * strike,
            easing,
          });
          break;
        case 'arm': {
          const isActiveSide = side === attackSide || side === 'center';
          generatedFrames[frame] = makePose(base, isActiveSide
            ? {
                x: base.x - 10 * direction * windup + 18 * direction * strike,
                y: base.y - 8 * windup - 2 * strike,
                rotation: base.rotation - 28 * direction * windup + 56 * direction * strike - 12 * direction * recovery,
                easing,
              }
            : {
                x: base.x - 3 * direction * strike,
                rotation: base.rotation - 8 * direction * strike + 4 * direction * recovery,
                easing,
              });
          break;
        }
        case 'hand': {
          const isActiveSide = side === attackSide || side === 'center';
          generatedFrames[frame] = makePose(base, isActiveSide
            ? {
                x: base.x - 14 * direction * windup + 28 * direction * strike,
                y: base.y - 10 * windup + 4 * strike,
                rotation: base.rotation - 24 * direction * windup + 88 * direction * strike - 18 * direction * recovery,
                easing,
              }
            : {
                rotation: base.rotation - 10 * direction * swing,
                easing,
              });
          break;
        }
        case 'hair':
          generatedFrames[frame] = makePose(base, {
            x: base.x + 3 * direction * windup - 6 * direction * strike,
            rotation: base.rotation + 8 * direction * windup - 14 * direction * strike + 5 * direction * recovery,
            easing,
          });
          break;
        case 'leg': {
          const isActiveSide = side === attackSide || side === 'center';
          generatedFrames[frame] = makePose(base, isActiveSide
            ? {
                x: base.x - 5 * direction * windup + 8 * direction * strike - 3 * direction * recovery,
                y: base.y + 4 * windup + 2 * recovery,
                rotation: base.rotation - 12 * direction * windup + 16 * direction * strike - 5 * direction * recovery,
                easing,
              }
            : {
                x: base.x + 4 * direction * windup - 6 * direction * strike,
                y: base.y + 2 * strike,
                rotation: base.rotation + 10 * direction * windup - 8 * direction * strike,
                easing,
              });
          break;
        }
        default:
          generatedFrames[frame] = makePose(base, {
            x: base.x + 4 * direction * strike,
            rotation: base.rotation + 2 * direction * swing,
            easing,
          });
          break;
      }
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  return {
    keyframes: nextKeyframes,
    duration,
    summary: `Attack motion applied: ${attackSide} side, ${fast ? 'fast' : heavy ? 'heavy' : 'standard'} timing, ${duration} frames`,
  };
};

const applyLocomotionPromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
  mode: 'walk' | 'run',
): { keyframes: Keyframes; duration: number; summary: string } => {
  const normalized = prompt.toLowerCase();
  const easing = parsePromptEasing(normalized) ?? 'linear';
  const fast = mode === 'run' || includesAny(normalized, ['fast', 'cepat', 'quick']);
  const duration = parseExplicitDuration(prompt) ?? clampDuration(fast ? 72 : 96);
  const stride = fast ? 1.55 : 1;
  const bounce = fast ? 1.4 : 0.9;
  const frames = [0, Math.round(duration * 0.25), Math.round(duration * 0.5), Math.round(duration * 0.75), duration];
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const side = detectBoneSide(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    frames.forEach((frame) => {
      const t = frame / duration;
      const wave = Math.sin(t * Math.PI * 2);
      const swing = side === 'left' ? wave : -wave;
      const lift = (1 - Math.cos(t * Math.PI * 4)) * 0.5;

      switch (role) {
        case 'body':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 5 * bounce * lift,
            x: base.x + 1.5 * stride * wave,
            rotation: base.rotation + 1.8 * wave,
            easing,
          });
          break;
        case 'head':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 2.4 * bounce * lift,
            rotation: base.rotation - 1.1 * wave,
            easing,
          });
          break;
        case 'arm':
          generatedFrames[frame] = makePose(base, {
            x: base.x + 3 * stride * swing,
            rotation: base.rotation + 18 * stride * swing,
            easing,
          });
          break;
        case 'hand':
          generatedFrames[frame] = makePose(base, {
            x: base.x + 4.5 * stride * swing,
            y: base.y + 2 * bounce * lift,
            rotation: base.rotation + 24 * stride * swing,
            easing,
          });
          break;
        case 'hair':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 1.5 * bounce * lift,
            rotation: base.rotation - 5.5 * wave,
            easing,
          });
          break;
        case 'leg':
          generatedFrames[frame] = makePose(base, {
            x: base.x + 5.5 * stride * swing,
            y: base.y + 3.5 * bounce * lift,
            rotation: base.rotation - 24 * stride * swing,
            easing,
          });
          break;
        default:
          generatedFrames[frame] = makePose(base, {
            rotation: base.rotation + 3 * swing,
            easing,
          });
          break;
      }
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  return {
    keyframes: nextKeyframes,
    duration,
    summary: `${mode === 'run' ? 'Run' : 'Walk'} cycle applied: ${fast ? 'fast timing' : 'standard timing'}`,
  };
};

const applyJumpPromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
): { keyframes: Keyframes; duration: number; summary: string } => {
  const normalized = prompt.toLowerCase();
  const easing = parsePromptEasing(normalized) ?? 'easeInOut';
  const soft = includesAny(normalized, ['soft', 'halus', 'gentle']);
  const high = includesAny(normalized, ['high', 'tinggi', 'big']);
  const duration = parseExplicitDuration(prompt) ?? clampDuration(soft ? 108 : 90);
  const jumpHeight = high ? 42 : 30;
  const frames = [0, Math.round(duration * 0.2), Math.round(duration * 0.45), Math.round(duration * 0.72), duration];
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    frames.forEach((frame) => {
      const t = frame / duration;
      const ascent = t <= 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      const compress = frame === frames[1] ? 1 : 0;
      const apex = frame === frames[2] ? 1 : 0;
      const landing = frame === frames[3] ? 1 : 0;

      switch (role) {
        case 'body':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 6 * compress - jumpHeight * apex - 14 * ascent + 8 * landing,
            scaleX: base.scaleX + 0.03 * compress - 0.02 * apex,
            scaleY: base.scaleY - 0.05 * compress + 0.06 * apex,
            rotation: base.rotation + 2 * landing,
            easing,
          });
          break;
        case 'head':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 3 * compress - (jumpHeight * 0.75) * apex - 10 * ascent,
            rotation: base.rotation - 3 * compress + 2 * landing,
            easing,
          });
          break;
        case 'arm':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 4 * compress - 10 * ascent,
            rotation: base.rotation - 18 * compress + 24 * apex - 10 * landing,
            easing,
          });
          break;
        case 'hand':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 6 * compress - 12 * ascent,
            rotation: base.rotation - 14 * compress + 30 * apex - 12 * landing,
            easing,
          });
          break;
        case 'hair':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 2 * compress - 4 * ascent,
            rotation: base.rotation + 6 * compress - 12 * landing,
            easing,
          });
          break;
        case 'leg': {
          const side = detectBoneSide(bone);
          const sideDirection = side === 'left' ? -1 : side === 'right' ? 1 : 0;
          generatedFrames[frame] = makePose(base, {
            x: base.x + 8 * sideDirection * compress - 6 * sideDirection * landing,
            y: base.y + 12 * compress - 22 * apex - 14 * ascent + 16 * landing,
            rotation: base.rotation + 18 * compress - 30 * apex - 26 * ascent + 24 * landing,
            easing,
          });
          break;
        }
        default:
          generatedFrames[frame] = makePose(base, {
            y: base.y - 6 * ascent + 3 * landing,
            easing,
          });
          break;
      }
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  return {
    keyframes: nextKeyframes,
    duration,
    summary: `Jump motion applied: ${high ? 'high arc' : 'standard arc'}${soft ? ', soft timing' : ''}`,
  };
};

const applyLandPromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
): { keyframes: Keyframes; duration: number; summary: string } => {
  const normalized = prompt.toLowerCase();
  const easing = parsePromptEasing(normalized) ?? 'easeInOut';
  const hard = includesAny(normalized, ['hard', 'keras', 'heavy', 'impact']);
  const duration = parseExplicitDuration(prompt) ?? clampDuration(hard ? 54 : 72);
  const frames = [0, Math.round(duration * 0.25), Math.round(duration * 0.5), duration];
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    frames.forEach((frame) => {
      const impact = frame === frames[1] ? 1 : 0;
      const settle = frame === frames[2] ? 1 : 0;

      switch (role) {
        case 'body':
          generatedFrames[frame] = makePose(base, {
            y: base.y + (hard ? 14 : 10) * impact + 4 * settle,
            scaleX: base.scaleX + 0.04 * impact,
            scaleY: base.scaleY - 0.06 * impact + 0.02 * settle,
            easing,
          });
          break;
        case 'head':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 5 * impact + 2 * settle,
            rotation: base.rotation + 3 * impact - 1.5 * settle,
            easing,
          });
          break;
        case 'arm':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 5 * impact,
            rotation: base.rotation + 16 * impact - 8 * settle,
            easing,
          });
          break;
        case 'hand':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 7 * impact,
            rotation: base.rotation + 20 * impact - 10 * settle,
            easing,
          });
          break;
        case 'hair':
          generatedFrames[frame] = makePose(base, {
            rotation: base.rotation - 16 * impact + 8 * settle,
            easing,
          });
          break;
        case 'leg': {
          const side = detectBoneSide(bone);
          const sideDirection = side === 'left' ? -1 : side === 'right' ? 1 : 0;
          generatedFrames[frame] = makePose(base, {
            x: base.x + 4 * sideDirection * impact - 2 * sideDirection * settle,
            y: base.y + (hard ? 12 : 9) * impact + 3 * settle,
            rotation: base.rotation + (hard ? 20 : 14) * impact - 9 * settle,
            easing,
          });
          break;
        }
        default:
          generatedFrames[frame] = makePose(base, {
            y: base.y + 3 * impact,
            easing,
          });
          break;
      }
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  return {
    keyframes: nextKeyframes,
    duration,
    summary: `Landing motion applied: ${hard ? 'hard impact' : 'soft impact'}`,
  };
};

export const getIdlePresetOptions = () =>
  (Object.entries(IDLE_PRESETS) as [IdlePresetId, IdlePresetDefinition][])
    .map(([id, preset]) => ({
      id,
      label: preset.label,
      description: preset.description,
    }));

export const applyIdlePresetToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  presetId: IdlePresetId,
): { keyframes: Keyframes; duration: number } => {
  const preset = IDLE_PRESETS[presetId];
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    preset.frames.forEach((frame) => {
      generatedFrames[frame] = preset.applyToBone(role, base, frame, preset.duration);
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  return {
    keyframes: nextKeyframes,
    duration: preset.duration,
  };
};

export const applyIdlePromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
): { keyframes: Keyframes; duration: number; summary: string } => {
  const intent = analyzePrompt(prompt);
  const easing = parsePromptEasing(prompt.toLowerCase()) ?? 'easeInOut';
  const frames = getPromptFrames(intent.duration);
  const nextKeyframes: Keyframes = JSON.parse(JSON.stringify(keyframes));

  bones.forEach((bone) => {
    const role = detectBoneRole(bone);
    const base = getBaseKeyframe(bone, nextKeyframes[bone.id]);
    const generatedFrames: Record<number, KeyframeData> = {};

    frames.forEach((frame, index) => {
      const t = frame / intent.duration;
      const breathe = Math.sin(t * Math.PI * 2);
      const lift = Math.max(0, breathe);
      const settle = Math.sin((t + 0.125) * Math.PI * 2);

      switch (role) {
        case 'body':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 6.5 * intent.breathing * lift,
            scaleX: base.scaleX + 0.006 * intent.breathing * lift,
            scaleY: base.scaleY + 0.018 * intent.breathing * lift,
            rotation: base.rotation + 0.25 * settle * (intent.speaking ? 1.2 : 0.5),
            easing,
          });
          break;
        case 'head':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 3.2 * intent.headBob * lift,
            rotation: base.rotation + 1.1 * intent.headBob * settle,
            easing,
          });
          break;
        case 'arm':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 2.3 * intent.handSway * lift,
            rotation: base.rotation + 2.1 * intent.handSway * settle,
            easing,
          });
          break;
        case 'hand':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 4.1 * intent.handSway * lift,
            rotation: base.rotation + 3.4 * intent.handSway * settle,
            easing,
          });
          break;
        case 'hair':
          generatedFrames[frame] = makePose(base, {
            y: base.y - 2.4 * intent.hairSway * lift,
            rotation: base.rotation - 2.8 * intent.hairSway * settle,
            easing,
          });
          break;
        case 'leg':
          generatedFrames[frame] = makePose(base, {
            y: base.y + 2.2 * intent.breathing * lift,
            rotation: base.rotation - 1.6 * settle,
            easing,
          });
          break;
        default:
          generatedFrames[frame] = makePose(base, {
            y: base.y - 1.2 * intent.breathing * lift,
            rotation: base.rotation + 0.35 * settle,
            easing,
          });
          break;
      }

      if (intent.speaking > 0 && index % 2 === 1 && role === 'head') {
        generatedFrames[frame] = makePose(generatedFrames[frame], {
          rotation: generatedFrames[frame].rotation + 0.5 * intent.speaking,
          y: generatedFrames[frame].y - 1 * intent.speaking,
        });
      }
    });

    nextKeyframes[bone.id] = generatedFrames;
  });

  const summaryParts = [
    intent.breathing <= 0.9 ? 'breathing halus' : 'breathing lebih terasa',
    intent.hairSway > 0.7 ? 'rambut sway aktif' : 'rambut sway ringan',
    intent.speaking > 0 ? 'head bob untuk speaking' : 'idle tenang',
  ];

  return {
    keyframes: nextKeyframes,
    duration: intent.duration,
    summary: `${intent.styleLabel}: ${summaryParts.join(', ')}`,
  };
};

export const applyAnimationPromptToKeyframes = (
  bones: Bone[],
  keyframes: Keyframes,
  prompt: string,
): { keyframes: Keyframes; duration: number; summary: string } => {
  if (isJumpPrompt(prompt)) {
    return applyJumpPromptToKeyframes(bones, keyframes, prompt);
  }

  if (isLandPrompt(prompt)) {
    return applyLandPromptToKeyframes(bones, keyframes, prompt);
  }

  if (isRunPrompt(prompt)) {
    return applyLocomotionPromptToKeyframes(bones, keyframes, prompt, 'run');
  }

  if (isWalkPrompt(prompt)) {
    return applyLocomotionPromptToKeyframes(bones, keyframes, prompt, 'walk');
  }

  if (isAttackPrompt(prompt)) {
    return applyAttackPromptToKeyframes(bones, keyframes, prompt);
  }

  return applyIdlePromptToKeyframes(bones, keyframes, prompt);
};
