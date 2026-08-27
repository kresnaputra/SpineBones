/**
 * Self-checks for `src/engine/mat4.ts` (Phase A step 1).
 *
 * The golden snapshot in `verify-transform-parity.ts` guards production output.
 * This file guards the new primitive layer *before* production depends on it:
 * it pins the matrix conventions that step 2's rewrite of
 * `computeAllWorldTransforms` will be built on, so a convention mistake shows up
 * here as a named failure instead of as a mysteriously shifted rig later.
 *
 * Returns null when mat4.ts does not exist yet, so the harness stays runnable
 * throughout the phase.
 */

import { buildFixtures } from './fixtures';
import { computeAllWorldTransforms } from '../../src/engine/transforms';
import type { Bone } from '../../src/types';

type Mat4Module = typeof import('../../src/engine/mat4');

export interface SelfCheckResult {
  failures: string[];
  notes: string[];
  passed: number;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const DEG2RAD = Math.PI / 180;

const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let worst = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    worst = Math.max(worst, Math.abs((a[i] ?? NaN) - (b[i] ?? NaN)));
  }
  return worst;
};

export const runMat4SelfChecks = async (): Promise<SelfCheckResult | null> => {
  let m: Mat4Module;
  try {
    m = await import('../../src/engine/mat4');
  } catch {
    return null;
  }

  const failures: string[] = [];
  const notes: string[] = [];
  let passed = 0;

  const check = (name: string, ok: boolean, detail = ''): void => {
    if (ok) {
      passed += 1;
      return;
    }
    failures.push(detail ? `${name}: ${detail}` : name);
  };

  // --- identity ------------------------------------------------------------
  check('identity() is the identity matrix', maxAbsDiff(m.identity(), IDENTITY) === 0);

  // --- multiply against identity ------------------------------------------
  const sample = m.fromTranslationRotationZ(13.25, -47.5, 31.75);
  check(
    'multiply(I, m) === m',
    maxAbsDiff(m.multiply(m.identity(), sample), sample) === 0,
  );
  check(
    'multiply(m, I) === m',
    maxAbsDiff(m.multiply(sample, m.identity()), sample) === 0,
  );

  // --- multiply aliasing ---------------------------------------------------
  {
    const a = m.fromTranslationRotationZ(9.5, 4.25, 22.5);
    const b = m.fromTranslationRotationZ(-3.75, 18.5, -14.25);
    const expected = m.multiply(a, b);

    const aliasA = m.copy(a);
    m.multiply(aliasA, b, aliasA);
    check('multiply writes correctly when out aliases a', maxAbsDiff(aliasA, expected) === 0);

    const aliasB = m.copy(b);
    m.multiply(a, aliasB, aliasB);
    check('multiply writes correctly when out aliases b', maxAbsDiff(aliasB, expected) === 0);
  }

  // --- the frame convention step 2 depends on ------------------------------
  // `fromTranslationRotationZ(tx, ty, rot)` must reproduce, exactly, the legacy
  // `toWorld` in meshSkinning / the child formula in transforms.ts:
  //     wx = tx + lx*cos(rot) - ly*sin(rot)
  //     wy = ty + lx*sin(rot) + ly*cos(rot)
  {
    const samples: Array<[number, number, number, number, number]> = [
      // tx, ty, rotDeg, lx, ly
      [12.5, -34.75, 23.5, 47.25, 8.5],
      [-8.25, 19.5, -33.25, 52.75, -14.5],
      [0, 0, 450, 35.75, -8.5],
      [4.25, -12.5, -540.25, -19.75, 61.25],
    ];
    let worst = 0;
    for (const [tx, ty, rot, lx, ly] of samples) {
      const r = rot * DEG2RAD;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const legacy = [tx + lx * cos - ly * sin, ty + lx * sin + ly * cos, 0];
      const viaMatrix = m.transformPoint(m.fromTranslationRotationZ(tx, ty, rot), lx, ly, 0);
      worst = Math.max(worst, maxAbsDiff(legacy, viaMatrix));
    }
    check(
      'fromTranslationRotationZ + transformPoint reproduce the legacy toWorld formula',
      worst === 0,
      `max delta ${worst}`,
    );
  }

  // --- accessors -----------------------------------------------------------
  check(
    'getTranslation reads the translation column',
    maxAbsDiff(m.getTranslation(m.fromTranslationRotationZ(7.25, -19.5, 61.75)), [7.25, -19.5, 0]) === 0,
  );
  check(
    'toFloat32 preserves float32-representable values',
    maxAbsDiff(m.toFloat32(m.ortho2D(0.5, -0.25, 0.125, 0.0625)), m.ortho2D(0.5, -0.25, 0.125, 0.0625)) === 0,
  );

  // --- world frames match what computeAllWorldTransforms produced -----------
  // `meshSkinning` builds a frame per attachment from the bone's scalars. However
  // that frame is produced, it must agree with the `_wx/_wy/_wrot` that the rest
  // of the codebase still reads.
  {
    let worst = 0;
    for (const fixture of buildFixtures()) {
      computeAllWorldTransforms(fixture.bones);
      for (const bone of fixture.bones) {
        const frame = m.fromTranslationRotationZ(bone._wx, bone._wy, bone._wrot);
        worst = Math.max(worst, maxAbsDiff(m.getTranslation(frame), [bone._wx, bone._wy, 0]));
      }
    }
    check('bone world frame built from _wx/_wy/_wrot round-trips exactly', worst === 0, `max delta ${worst}`);
  }

  // --- why frames must NOT be composed by matrix product --------------------
  // Composing parent x local computes cos(a+b) as cos(a)cos(b) - sin(a)sin(b),
  // which is not bit-identical to Math.cos(a+b). Measure the drift so the design
  // decision — keep the hierarchy scalar — rests on a number, not a hunch.
  {
    let worst = 0;
    let worstWhere = '';
    for (const fixture of buildFixtures()) {
      computeAllWorldTransforms(fixture.bones);
      const byId = new Map(fixture.bones.map((b) => [b.id, b]));
      const frames = new Map<number, ReturnType<Mat4Module['create']>>();

      const solve = (bone: Bone): ReturnType<Mat4Module['create']> => {
        const cached = frames.get(bone.id);
        if (cached) return cached;
        if (bone.parentId === null) {
          const f = m.fromTranslationRotationZ(bone.x, bone.y, bone.rotation);
          frames.set(bone.id, f);
          return f;
        }
        const parent = byId.get(bone.parentId);
        if (!parent) {
          const f = m.fromTranslationRotationZ(bone.x, bone.y, bone.rotation);
          frames.set(bone.id, f);
          return f;
        }
        const parentFrame = solve(parent);
        const local = m.fromTranslationRotationZ(
          bone.x * parent.scaleX,
          bone.y * parent.scaleY,
          bone.rotation,
        );
        const f = m.multiply(parentFrame, local);
        frames.set(bone.id, f);
        return f;
      };

      for (const bone of fixture.bones) {
        // Skip the case whose scalar path is itself known-wrong today.
        if (fixture.expectChange) continue;
        const [px, py] = m.getTranslation(solve(bone));
        const d = Math.max(Math.abs(px! - bone._wx), Math.abs(py! - bone._wy));
        if (d > worst) {
          worst = d;
          worstWhere = `${fixture.name}/${bone.name}`;
        }
      }
    }
    if (worst === 0) {
      notes.push('matrix-product composition happens to match the scalar path exactly on these fixtures');
    } else {
      notes.push(
        `matrix-product composition drifts from the scalar path by up to ${worst.toExponential(3)} ` +
          `(worst: ${worstWhere}) — world frames must be derived from _wx/_wy/_wrot, not composed by multiplying`,
      );
    }
  }

  return { failures, notes, passed };
};

