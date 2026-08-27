/**
 * Phase A parity harness — golden-snapshot check for the 4x4-matrix rewrite.
 *
 * Phase A swaps the maths substrate of `engine/transforms.ts` and
 * `engine/meshSkinning.ts` from 2D affine to 4x4 matrices with z = 0. The whole
 * point is that NOTHING changes visually, so this script pins the current
 * numbers down and fails on any drift.
 *
 *   bun scripts/phase-a/verify-transform-parity.ts --write   # record baseline
 *   bun scripts/phase-a/verify-transform-parity.ts           # verify (exit 1 on drift)
 *
 * Both modules under test are pure and DOM-free, so this runs headless.
 *
 * Tolerance is exact zero, deliberately. The refactor is designed to be
 * bit-identical: `mat4 * vec4(x, y, 0, 1)` adds only exact-zero terms to the
 * products the current code already computes. Anything non-zero here means a
 * term was reordered or dropped, and that is exactly what we want to catch.
 *
 * Cases flagged `expectChange` (known latent bugs the rewrite fixes) are
 * reported separately and never fail the run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeAllWorldTransforms, getBoneTip } from '../../src/engine/transforms';
import type { Attachment, Bone, Slot } from '../../src/types';
import { getAttachmentGeometry } from '../../src/engine/meshSkinning';
import { computeDrawSequence } from '../../src/engine/drawOrder';
import { computeTransform } from '../../src/engine/webgl/meshRenderer';
import { getViewportRect, type ViewportRect } from '../../src/engine/viewport';
import { buildFixtures, type FixtureCase } from './fixtures';
import { runMat4SelfChecks } from './mat4-selfcheck';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, 'golden', 'transform-parity.json');

// -----------------------------------------------------------------------------
// Camera configurations exercised by the world->clip transform.
// -----------------------------------------------------------------------------

interface CameraCase {
  label: string;
  note: string;
  viewportRect: ViewportRect;
  camX: number;
  camY: number;
  camZoom: number;
  canvasWidth: number;
  canvasHeight: number;
}

const buildCameras = (): CameraCase[] => [
  {
    label: 'editor-default',
    note: 'live preview, camera at origin, zoom 1',
    viewportRect: getViewportRect(1600, 900),
    camX: 0,
    camY: 0,
    camZoom: 1,
    canvasWidth: 1600,
    canvasHeight: 900,
  },
  {
    label: 'editor-panned-zoomed',
    note: 'live preview, panned off-origin at a fractional zoom',
    viewportRect: getViewportRect(1440, 1010),
    camX: 123.5,
    camY: -87.25,
    camZoom: 2.375,
    canvasWidth: 1440,
    canvasHeight: 1010,
  },
  {
    label: 'export-1920x1080',
    note: 'offscreen export path — viewportRect is exactly the video frame, so effective zoom === camZoom',
    viewportRect: { x: 0, y: 0, width: 1920, height: 1080 },
    camX: -41.75,
    camY: 62.5,
    camZoom: 0.8125,
    canvasWidth: 1920,
    canvasHeight: 1080,
  },
];

// -----------------------------------------------------------------------------
// Snapshot construction
// -----------------------------------------------------------------------------

interface GeometrySnapshot {
  attachment: string;
  boneId: number;
  vertexCount: number;
  /**
   * Floats per position in the live buffer: 2 today, 3 after Phase A. Recorded
   * for information only — never compared, so the golden survives the switch.
   */
  positionStride: number;
  /** Always [x, y, z]; z is synthesised as 0 while the pipeline is 2D. */
  points: number[][];
  uvs: number[][];
  indices: number[];
  /** World->clip output per camera, mirroring the vertex shader. */
  clip: Record<string, number[][]>;
}

interface BoneSnapshot {
  id: number;
  name: string;
  wx: number;
  wy: number;
  wrot: number;
  tipX: number;
  tipY: number;
}

interface CaseSnapshot {
  expectChange: boolean;
  note: string;
  bones: BoneSnapshot[];
  attachments: GeometrySnapshot[];
  /** Only on fixtures that carry slots — the order the renderer draws them in. */
  drawSequence?: string[];
}

interface Snapshot {
  schema: number;
  cameras: Record<string, { note: string; transform: number[] }>;
  cases: Record<string, CaseSnapshot>;
}

const SCHEMA = 1;

/**
 * Mirror of the vertex shader in `glContext.ts`:
 *   gl_Position = vec4(pos.x * ax + bx, pos.y * ay + by, 0, 1)
 *
 * Once `engine/mat4.ts` exists (Phase A step 1) this also evaluates the matrix
 * form and asserts the two agree exactly, so step 5's shader change is checked
 * without needing a browser.
 */
type Mat4Module = typeof import('../../src/engine/mat4');

let mat4: Mat4Module | null = null;
try {
  mat4 = await import('../../src/engine/mat4');
} catch {
  mat4 = null; // Not written yet — expected until step 1 lands.
}

const mat4Mismatches: string[] = [];

const toClip = (
  transform: [number, number, number, number],
  x: number,
  y: number,
  z: number,
  where: string,
): number[] => {
  // `uniformMatrix4fv(uMVP, ...)` hands the GPU float32 coefficients, exactly as
  // the `uniform4f(uTransform, ...)` it replaced did, so quantise them the same
  // way here. Without this the float64 reference below and a Float32Array-backed
  // mat4 disagree in the last few bits for reasons that have nothing to do with
  // the refactor — noise that would drown out real drift.
  const ax = Math.fround(transform[0]);
  const ay = Math.fround(transform[1]);
  const bx = Math.fround(transform[2]);
  const by = Math.fround(transform[3]);
  const direct = [x * ax + bx, y * ay + by];

  if (mat4) {
    // Push it through `toFloat32` first: that is the exact path the matrix takes
    // to `uniformMatrix4fv`, so this compares what the GPU will really receive.
    const m = mat4.toFloat32(mat4.ortho2D(ax, ay, bx, by));
    const viaMatrix = mat4.transformPoint(m, x, y, z);
    if (viaMatrix[0] !== direct[0] || viaMatrix[1] !== direct[1]) {
      mat4Mismatches.push(
        `${where}: direct (${direct[0]}, ${direct[1]}) vs mat4 (${viaMatrix[0]}, ${viaMatrix[1]})`,
      );
    }
  }

  return direct;
};

/**
 * The draw sequence, from the function the renderer itself calls.
 *
 * B0 recorded this from a copy of the renderer's nested loop; B1 extracted that
 * loop into `computeDrawSequence` and pointed both the renderer and this harness
 * at it. The golden was recorded against the copy, so it still passing is the
 * proof that the extraction changed nothing.
 */
const drawSequence = (
  bones: Bone[],
  slots: Slot[],
  attachments: Attachment[],
): string[] =>
  computeDrawSequence(bones, slots, attachments).map(
    (item) => `bone${item.bone.id}/slot${item.slot.id}/${item.attachment.name}`,
  );

const snapshotCase = (fixture: FixtureCase, cameras: CameraCase[]): CaseSnapshot => {
  // Mutates in place, exactly as every one of the 22 production call sites does.
  computeAllWorldTransforms(fixture.bones);

  const bones: BoneSnapshot[] = fixture.bones
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((bone) => {
      const tip = getBoneTip(bone);
      return {
        id: bone.id,
        name: bone.name,
        wx: bone._wx,
        wy: bone._wy,
        wrot: bone._wrot,
        tipX: tip.x,
        tipY: tip.y,
      };
    });

  const attachments: GeometrySnapshot[] = fixture.attachments.map(({ attachment, boneId }) => {
    const bone = fixture.bones.find((b) => b.id === boneId);
    if (!bone) throw new Error(`fixture ${fixture.name}: no bone ${boneId}`);

    const geo = getAttachmentGeometry(attachment, bone, fixture.bones);

    // UVs stay 2 floats per vertex through Phase A, so they give us the vertex
    // count independently of the position stride we are about to change.
    const vertexCount = geo.uvs.length / 2;
    const positionStride = geo.positions.length / vertexCount;
    if (!Number.isInteger(positionStride) || positionStride < 2 || positionStride > 3) {
      throw new Error(
        `fixture ${fixture.name}/${attachment.name}: unexpected position stride ${positionStride}`,
      );
    }

    const points: number[][] = [];
    for (let i = 0; i < vertexCount; i += 1) {
      const x = geo.positions[i * positionStride]!;
      const y = geo.positions[i * positionStride + 1]!;
      const z = positionStride === 3 ? geo.positions[i * positionStride + 2]! : 0;
      if (z !== 0) {
        throw new Error(
          `fixture ${fixture.name}/${attachment.name} vertex ${i}: z must stay 0 in Phase A, got ${z}`,
        );
      }
      points.push([x, y, z]);
    }

    const uvs: number[][] = [];
    for (let i = 0; i < vertexCount; i += 1) {
      uvs.push([geo.uvs[i * 2]!, geo.uvs[i * 2 + 1]!]);
    }

    const clip: Record<string, number[][]> = {};
    for (const camera of cameras) {
      const transform = computeTransform(
        camera.viewportRect,
        camera.camX,
        camera.camY,
        camera.camZoom,
        camera.canvasWidth,
        camera.canvasHeight,
      );
      clip[camera.label] = points.map(([x, y, z], i) =>
        toClip(transform, x!, y!, z!, `${fixture.name}/${attachment.name}@${camera.label}[${i}]`),
      );
    }

    return {
      attachment: attachment.name,
      boneId,
      vertexCount,
      positionStride,
      points,
      uvs,
      indices: Array.from(geo.indices),
      clip,
    };
  });

  return {
    expectChange: fixture.expectChange,
    note: fixture.note,
    bones,
    attachments,
    ...(fixture.slots
      ? {
          drawSequence: drawSequence(
            fixture.bones,
            fixture.slots,
            fixture.attachments.map((a) => a.attachment),
          ),
        }
      : {}),
  };
};

const buildSnapshot = (): Snapshot => {
  const cameras = buildCameras();
  const snapshot: Snapshot = { schema: SCHEMA, cameras: {}, cases: {} };

  for (const camera of cameras) {
    snapshot.cameras[camera.label] = {
      note: camera.note,
      transform: Array.from(
        computeTransform(
          camera.viewportRect,
          camera.camX,
          camera.camY,
          camera.camZoom,
          camera.canvasWidth,
          camera.canvasHeight,
        ),
      ),
    };
  }

  for (const fixture of buildFixtures()) {
    snapshot.cases[fixture.name] = snapshotCase(fixture, cameras);
  }

  return snapshot;
};

// -----------------------------------------------------------------------------
// Comparison
// -----------------------------------------------------------------------------

interface Diff {
  path: string;
  golden: unknown;
  current: unknown;
  delta: number | null;
}

const diffValues = (path: string, golden: unknown, current: unknown, out: Diff[]): void => {
  if (typeof golden === 'number' && typeof current === 'number') {
    if (!Object.is(golden, current)) {
      out.push({ path, golden, current, delta: Math.abs(golden - current) });
    }
    return;
  }

  if (Array.isArray(golden) && Array.isArray(current)) {
    if (golden.length !== current.length) {
      out.push({ path: `${path}.length`, golden: golden.length, current: current.length, delta: null });
    }
    const n = Math.min(golden.length, current.length);
    for (let i = 0; i < n; i += 1) diffValues(`${path}[${i}]`, golden[i], current[i], out);
    return;
  }

  const bothObjects =
    golden !== null && current !== null && typeof golden === 'object' && typeof current === 'object';
  if (bothObjects) {
    const g = golden as Record<string, unknown>;
    const c = current as Record<string, unknown>;
    for (const key of new Set([...Object.keys(g), ...Object.keys(c)])) {
      if (!(key in g)) {
        out.push({ path: `${path}.${key}`, golden: undefined, current: c[key], delta: null });
        continue;
      }
      if (!(key in c)) {
        out.push({ path: `${path}.${key}`, golden: g[key], current: undefined, delta: null });
        continue;
      }
      diffValues(`${path}.${key}`, g[key], c[key], out);
    }
    return;
  }

  if (golden !== current) {
    out.push({ path, golden, current, delta: null });
  }
};

/** `positionStride` is informational — it is meant to change in step 4. */
const isInformationalPath = (path: string): boolean => /\.positionStride$/.test(path);

const formatDiff = (diff: Diff): string => {
  const delta = diff.delta === null ? 'structural' : `delta ${diff.delta}`;
  return `      ${diff.path}\n        golden:  ${JSON.stringify(diff.golden)}\n        current: ${JSON.stringify(diff.current)}\n        ${delta}`;
};

const MAX_DIFFS_SHOWN = 8;

const reportSelfChecks = async (): Promise<number> => {
  const result = await runMat4SelfChecks();
  if (!result) {
    console.log('  skip  engine/mat4.ts not present yet — matrix primitives unchecked (expected before step 1)');
    return 0;
  }

  for (const note of result.notes) console.log(`  note  ${note}`);

  if (!result.failures.length) {
    console.log(`  ok    engine/mat4.ts primitives — ${result.passed} check(s)`);
    return 0;
  }

  console.error(`\n  FAIL  engine/mat4.ts primitives — ${result.failures.length} of ${result.failures.length + result.passed} check(s)`);
  result.failures.forEach((f) => console.error(`      ${f}`));
  return result.failures.length;
};

const verify = (golden: Snapshot, current: Snapshot, selfCheckFailures: number): number => {
  if (golden.schema !== current.schema) {
    console.error(`Golden schema ${golden.schema} != harness schema ${current.schema}. Re-record with --write.`);
    return 1;
  }

  let failed = selfCheckFailures;
  let informational = 0;
  const expectedChanges: string[] = [];

  const cameraDiffs: Diff[] = [];
  diffValues('cameras', golden.cameras, current.cameras, cameraDiffs);
  if (cameraDiffs.length) {
    failed += cameraDiffs.length;
    console.error(`\n  FAIL  world->clip transform changed (${cameraDiffs.length} diff(s))`);
    cameraDiffs.slice(0, MAX_DIFFS_SHOWN).forEach((d) => console.error(formatDiff(d)));
  } else {
    console.log('  ok    world->clip transform identical across all 3 camera configs');
  }

  const names = new Set([...Object.keys(golden.cases), ...Object.keys(current.cases)]);
  for (const name of [...names].sort()) {
    const g = golden.cases[name];
    const c = current.cases[name];
    if (!g || !c) {
      console.error(`\n  FAIL  case "${name}" exists in only one snapshot. Re-record with --write.`);
      failed += 1;
      continue;
    }

    const diffs: Diff[] = [];
    diffValues(name, g, c, diffs);

    const real = diffs.filter((d) => !isInformationalPath(d.path));
    const info = diffs.filter((d) => isInformationalPath(d.path));
    informational += info.length;

    if (info.length) {
      const strides = [...new Set(info.map((d) => `${d.golden} -> ${d.current}`))].join(', ');
      console.log(`  note  ${name}: position stride ${strides} (expected once step 4 lands)`);
    }

    if (!real.length) {
      console.log(`  ok    ${name}${c.expectChange ? '  (flagged expectChange — still identical)' : ''}`);
      continue;
    }

    if (c.expectChange) {
      expectedChanges.push(name);
      const worst = real.reduce((m, d) => Math.max(m, d.delta ?? Infinity), 0);
      console.log(`  CHANGED  ${name} — ${real.length} diff(s), max delta ${worst}`);
      console.log(`           ${c.note}`);
      console.log('           Flagged as an expected fix. Review the numbers below by hand.');
      real.slice(0, MAX_DIFFS_SHOWN).forEach((d) => console.log(formatDiff(d)));
      if (real.length > MAX_DIFFS_SHOWN) console.log(`      ... ${real.length - MAX_DIFFS_SHOWN} more`);
      continue;
    }

    failed += real.length;
    const worst = real.reduce((m, d) => Math.max(m, d.delta ?? Infinity), 0);
    console.error(`\n  FAIL  ${name} — ${real.length} diff(s), max delta ${worst}`);
    console.error(`        ${c.note}`);
    real.slice(0, MAX_DIFFS_SHOWN).forEach((d) => console.error(formatDiff(d)));
    if (real.length > MAX_DIFFS_SHOWN) console.error(`      ... ${real.length - MAX_DIFFS_SHOWN} more`);
  }

  console.log('');
  if (mat4) {
    if (mat4Mismatches.length) {
      console.error(`  FAIL  engine/mat4.ts disagrees with the direct transform (${mat4Mismatches.length} point(s))`);
      mat4Mismatches.slice(0, MAX_DIFFS_SHOWN).forEach((m) => console.error(`      ${m}`));
      failed += mat4Mismatches.length;
    } else {
      console.log('  ok    engine/mat4.ts ortho2D/transformPoint match the direct transform exactly');
    }
  }

  if (informational) console.log(`  ${informational} informational diff(s) ignored`);
  if (expectedChanges.length) {
    console.log(`  ${expectedChanges.length} expected change(s): ${expectedChanges.join(', ')}`);
  }

  if (failed) {
    console.error(`\nFAILED — ${failed} unexpected diff(s)/check(s). Phase A must be bit-identical.\n`);
    return 1;
  }

  console.log('\nPASS — geometry, world transforms and clip coords are identical.\n');
  return 0;
};

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

const main = async (): Promise<number> => {
  const write = process.argv.includes('--write');
  const current = buildSnapshot();

  if (write) {
    mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(current, null, 2)}\n`);
    const cases = Object.keys(current.cases).length;
    const points = Object.values(current.cases).reduce(
      (sum, c) => sum + c.attachments.reduce((s, a) => s + a.vertexCount, 0),
      0,
    );
    console.log(`Wrote baseline: ${cases} cases, ${points} vertices -> ${GOLDEN_PATH}`);
    if (mat4Mismatches.length) {
      console.error(`\nWARNING: engine/mat4.ts disagrees with the direct transform at ${mat4Mismatches.length} point(s).`);
      mat4Mismatches.slice(0, MAX_DIFFS_SHOWN).forEach((m) => console.error(`  ${m}`));
      return 1;
    }
    return 0;
  }

  if (!existsSync(GOLDEN_PATH)) {
    console.error(`No baseline at ${GOLDEN_PATH}.\nRecord one first:\n  bun ${process.argv[1]} --write\n`);
    return 1;
  }

  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Snapshot;
  console.log('Phase A parity check\n');

  const selfCheckFailures = await reportSelfChecks();
  return verify(golden, current, selfCheckFailures);
};

process.exit(await main());
