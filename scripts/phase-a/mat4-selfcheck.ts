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

  // --- the identity contract Phase B rests on -------------------------------
  // `ortho2D * orbitTransform(..., 0, 0)` must reproduce `ortho2D` bit for bit,
  // or every existing project shifts the moment the orbit camera is wired in.
  {
    check('fromRotationY(0) is exactly identity', maxAbsDiff(m.fromRotationY(0), IDENTITY) === 0);
    check('fromRotationX(0) is exactly identity', maxAbsDiff(m.fromRotationX(0), IDENTITY) === 0);

    let worst = 0;
    for (const [fx, fy] of [[0, 0], [123.5, -87.25], [-41.75, 62.5]] as const) {
      worst = Math.max(worst, maxAbsDiff(m.orbitTransform(fx, fy, 0, 0), IDENTITY));
    }
    check('orbitTransform(focus, 0, 0) is exactly identity for any focus', worst === 0, `max delta ${worst}`);

    let worstProj = 0;
    for (const [ax, ay, bx, by] of [
      [0.0011, -0.0019, 0.37, -0.21],
      [0.0025, -0.0044, -0.13, 0.58],
    ] as const) {
      const plain = m.ortho2D(ax, ay, bx, by);
      const composed = m.multiply(m.ortho2D(ax, ay, bx, by), m.orbitTransform(123.5, -87.25, 0, 0));
      worstProj = Math.max(worstProj, maxAbsDiff(plain, composed));
    }
    check('ortho2D * orbitTransform(0, 0) === ortho2D exactly', worstProj === 0, `max delta ${worstProj}`);

    // And it must actually do something once the camera turns.
    const turned = m.orbitTransform(0, 0, 30, 0);
    check('orbitTransform(yaw 30) is not the identity', maxAbsDiff(turned, IDENTITY) > 0.1);

    // Rotating about the focus must leave the focus itself where it is.
    const [px, py] = m.transformPoint(m.orbitTransform(123.5, -87.25, 37.5, 12.25), 123.5, -87.25, 0);
    check(
      'orbitTransform leaves its focus point fixed',
      Math.abs(px! - 123.5) < 1e-9 && Math.abs(py! - -87.25) < 1e-9,
      `moved to (${px}, ${py})`,
    );
  }

  // --- the overlay must land exactly where it used to at rest ---------------
  // `createOrbitWorldToScreen` feeds 28 call sites: bones, handles, outlines,
  // mesh wireframes, hit-testing. If it drifts even sub-pixel at yaw 0, every
  // one of them stops agreeing with the sprites the GPU drew.
  {
    const { createOrbitWorldToScreen, createViewportWorldToScreen, getViewportRect } =
      await import('../../src/engine/viewport');

    const rect = getViewportRect(1600, 900);
    let worstRest = 0;
    let movedWhenTurned = 0;

    for (const [camX, camY, zoom] of [[0, 0, 1], [123.5, -87.25, 2.375], [-41.75, 62.5, 0.8125]] as const) {
      const flat = createViewportWorldToScreen(rect, camX, camY, zoom);
      const rest = createOrbitWorldToScreen(rect, camX, camY, zoom, 0, 0);
      const turned = createOrbitWorldToScreen(rect, camX, camY, zoom, 30, 15);

      for (const [wx, wy] of [[0, 0], [147.25, -83.5], [-61.75, 209.25]] as const) {
        const a = flat(wx, wy);
        const b = rest(wx, wy);
        worstRest = Math.max(worstRest, Math.abs(a.x - b.x), Math.abs(a.y - b.y));

        const c = turned(wx, wy);
        movedWhenTurned = Math.max(movedWhenTurned, Math.abs(a.x - c.x) + Math.abs(a.y - c.y));
      }
    }

    check(
      'createOrbitWorldToScreen at yaw 0 matches the 2D projection exactly',
      worstRest === 0,
      `max delta ${worstRest}`,
    );
    check('createOrbitWorldToScreen actually moves points once turned', movedWhenTurned > 1);

    // A point on the orbit axis must not move, however far the camera swings.
    const pinned = createOrbitWorldToScreen(rect, 44.5, -18.75, 1, 65, -40);
    const flatPinned = createViewportWorldToScreen(rect, 44.5, -18.75, 1);
    const a = flatPinned(44.5, -18.75);
    const b = pinned(44.5, -18.75);
    check(
      'the orbit focus itself stays put on screen',
      Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9,
      `moved by (${a.x - b.x}, ${a.y - b.y})`,
    );
  }

  // --- screen <-> world must round-trip under an orbited camera --------------
  {
    const { createOrbitScreenToWorld, createOrbitWorldToScreen, createViewportScreenToWorld, getViewportRect } =
      await import('../../src/engine/viewport');

    // orbit * inverse must be the identity, not merely close.
    let worstInv = 0;
    for (const [yaw, pitch] of [[0, 0], [30, 15], [-72.5, -40.25], [155, 80]] as const) {
      const round = m.multiply(m.orbitTransform(44.5, -18.75, yaw, pitch), m.orbitTransformInverse(44.5, -18.75, yaw, pitch));
      worstInv = Math.max(worstInv, maxAbsDiff(round, IDENTITY));
    }
    check('orbitTransform * orbitTransformInverse is the identity', worstInv < 1e-12, `max delta ${worstInv}`);

    const rect = getViewportRect(1600, 900);

    // At rest the inverse must be the untouched 2D one.
    let worstRest = 0;
    const flatInv = createViewportScreenToWorld(rect, 123.5, -87.25, 2.375);
    const restInv = createOrbitScreenToWorld(rect, 123.5, -87.25, 2.375, 0, 0);
    for (const [sx, sy] of [[0, 0], [811.5, 447.25], [1599, 12.75]] as const) {
      const a = flatInv(sx, sy);
      const b = restInv(sx, sy)!;
      worstRest = Math.max(worstRest, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    check('createOrbitScreenToWorld at yaw 0 matches the 2D inverse exactly', worstRest === 0, `max delta ${worstRest}`);

    // World -> screen -> world must return the point, on whichever plane it sits.
    let worstTrip = 0;
    for (const [yaw, pitch] of [[30, 15], [-72.5, -40.25], [65, 85]] as const) {
      const fwd = createOrbitWorldToScreen(rect, 44.5, -18.75, 1.25, yaw, pitch);
      const inv = createOrbitScreenToWorld(rect, 44.5, -18.75, 1.25, yaw, pitch);
      for (const planeZ of [0, 6, -4]) {
        for (const [wx, wy] of [[0, 0], [147.25, -83.5], [-61.75, 209.25]] as const) {
          const screen = fwd(wx, wy, planeZ);
          const back = inv(screen.x, screen.y, planeZ)!;
          worstTrip = Math.max(worstTrip, Math.abs(back.x - wx), Math.abs(back.y - wy));
        }
      }
    }
    check('world -> screen -> world returns the point on its plane', worstTrip < 1e-8, `max drift ${worstTrip}`);

    // Edge-on must refuse rather than guess.
    check(
      'unprojection refuses when the plane is edge-on',
      createOrbitScreenToWorld(rect, 0, 0, 1, 90, 0)(800, 450) === null,
    );
    check(
      'unprojection still works at the pitch clamp',
      createOrbitScreenToWorld(rect, 0, 0, 1, 0, 85)(800, 450) !== null,
    );
  }

  // --- the 3D path: when it engages, and what it guarantees ------------------
  {
    const mkBone = (id: number, parentId: number | null, x: number, tilt?: number): Bone => ({
      id, name: `b${id}`, x, y: 0, length: 50, rotation: 0, scaleX: 1, scaleY: 1,
      parentId, skinId: 0, _wx: 0, _wy: 0, _wrot: 0,
      ...(tilt !== undefined ? { rotationY: tilt } : {}),
    });

    // A rig with no tilt must stay on the scalar path — that is what keeps every
    // existing project bit-identical.
    const flat = [mkBone(0, null, 0), mkBone(1, 0, 60)];
    computeAllWorldTransforms(flat);
    check('a flat rig carries no world matrix', flat.every((b) => !b._wm));

    const tilted = [mkBone(0, null, 0, 50), mkBone(1, 0, 60)];
    computeAllWorldTransforms(tilted);
    check('a tilted rig carries a world matrix on every bone', tilted.every((b) => !!b._wm));
    check(
      'the world matrix is a plain array of 16 numbers, not a typed array',
      tilted.every((b) => Array.isArray(b._wm) && b._wm.length === 16 && b._wm.every(Number.isFinite)),
    );

    // Bones are put through JSON by undo snapshots and by project saving. A
    // typed array would come back as an object; a plain array must survive.
    const revived = JSON.parse(JSON.stringify(tilted[0])) as Bone;
    check(
      'a bone survives a JSON round-trip with its matrix intact',
      Array.isArray(revived._wm) && maxAbsDiff(revived._wm, tilted[0]!._wm!) === 0,
    );

    // Clearing the tilt must drop the frame again, or meshSkinning keeps reading
    // a stale matrix instead of returning to its 2D fast path.
    const cleared = tilted.map((b) => ({ ...b, rotationY: 0 }));
    computeAllWorldTransforms(cleared);
    check('clearing the tilt drops the world matrix', cleared.every((b) => !b._wm));

    // Inheritance: only descendants move.
    const chain = [mkBone(0, null, 0), mkBone(1, 0, 60, 50), mkBone(2, 1, 60), mkBone(3, 2, 60)];
    const before = [mkBone(0, null, 0), mkBone(1, 0, 60), mkBone(2, 1, 60), mkBone(3, 2, 60)];
    computeAllWorldTransforms(chain);
    computeAllWorldTransforms(before);
    check(
      'tilting a middle bone leaves its ancestor exactly where it was',
      chain[0]!._wx === before[0]!._wx && chain[0]!._wy === before[0]!._wy,
    );
    check(
      'tilting a middle bone carries every descendant with it',
      chain.slice(2).every((b, i) => Math.abs(b._wx - before[i + 2]!._wx) > 1),
      `moved by ${chain.slice(2).map((b, i) => (b._wx - before[i + 2]!._wx).toFixed(2)).join(', ')}`,
    );

    // A descendant two levels down must land exactly where composing the frames
    // by hand puts it — the arithmetic, not just "it moved".
    const expectedX = 60 + 60 * Math.cos((50 * Math.PI) / 180);
    check(
      'the inherited position matches the closed form',
      Math.abs(chain[2]!._wx - expectedX) < 1e-9,
      `${chain[2]!._wx} vs ${expectedX}`,
    );
  }

  // --- tilt is keyframed and interpolated like any other channel -------------
  {
    const { sampleBonePoseAtFrame } = await import('../../src/utils/animationPose');
    const bone: Bone = {
      id: 7, name: 'b', x: 0, y: 0, length: 50, rotation: 0, scaleX: 1, scaleY: 1,
      parentId: null, skinId: 0, _wx: 0, _wy: 0, _wrot: 0, rotationY: 99,
    };
    const keys = {
      7: {
        0: { x: 0, y: 0, rotation: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
        10: { x: 0, y: 0, rotation: 0, rotationY: 60, scaleX: 1, scaleY: 1 },
      },
    };
    check(
      'tilt interpolates between keyframes',
      sampleBonePoseAtFrame(bone, keys, {}, 5).rotationY === 30,
    );

    // Keyframes written before the field existed mean zero, exactly as they do
    // for every other channel — but must not disturb the channels they do have.
    const legacy = {
      7: {
        0: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        10: { x: 0, y: 0, rotation: 30, scaleX: 1, scaleY: 1 },
      },
    };
    const sampled = sampleBonePoseAtFrame(bone, legacy, {}, 5);
    check('a legacy keyframe reads as zero tilt', sampled.rotationY === 0);
    check('a legacy keyframe still interpolates its own channels', sampled.rotation === 15);

    // With no keyframes at all the bone keeps whatever tilt it was given.
    check(
      'an unkeyframed bone keeps its tilt',
      sampleBonePoseAtFrame(bone, {}, {}, 5).rotationY === 99,
    );
  }

  // --- rigid inverse: the move tool's world -> local conversion --------------
  // Converting a dragged world point into a tilted parent's local space using
  // only its Z angle foreshortens by cos(tilt) — and past 90 degrees the sign
  // flips, so the bone runs the wrong way. These pin the real inverse down.
  {
    let worstRound = 0;
    let worstPoint = 0;
    for (const [tx, ty, rotZ, rotY, rotX] of [
      [0, 0, 0, 0, 0],
      [12.5, -7.25, 33.5, 0, 0],
      [-41.75, 62.5, -18.25, 47.5, 0],
      [8.5, 19.75, 61.25, 118.5, -29.75], // past 90 degrees: where the sign flipped
    ] as const) {
      const frame = m.multiply(
        m.fromTranslation(tx, ty, 0),
        m.multiply(m.multiply(m.fromRotationY(rotY), m.fromRotationX(rotX)), m.fromTranslationRotationZ(0, 0, rotZ)),
      );
      worstRound = Math.max(worstRound, maxAbsDiff(m.multiply(frame, m.invertRigid(frame)), IDENTITY));

      for (const [px, py, pz] of [[0, 0, 0], [147.25, -83.5, 0], [-61.75, 209.25, 34.5]] as const) {
        const [wx, wy, wz] = m.transformPoint(frame, px, py, pz);
        const [bx, by, bz] = m.transformPoint(m.invertRigid(frame), wx!, wy!, wz!);
        worstPoint = Math.max(worstPoint, Math.abs(bx! - px), Math.abs(by! - py), Math.abs(bz! - pz));
      }
    }
    check('frame * invertRigid(frame) is the identity', worstRound < 1e-12, `max delta ${worstRound}`);
    check('a point survives frame then inverse unchanged', worstPoint < 1e-9, `max drift ${worstPoint}`);

    // The failure this fixed: past 90 degrees the Z-only conversion puts the
    // bone on the *opposite* side of the parent from the cursor. What matters is
    // not the sign of the local coordinate — it is legitimately negative here —
    // but where the bone ends up in the world once the frame is reapplied.
    const parent = m.fromRotationY(120);
    const cursorWorldX = 100;

    // Z-only: local x is taken as the world delta, unchanged.
    const [naiveWorldX] = m.transformPoint(parent, cursorWorldX, 0, 0);
    // Full inverse: map into the parent's frame first.
    const [localX, localY] = m.transformPoint(m.invertRigid(parent), cursorWorldX, 0, 0);
    const [fixedWorldX] = m.transformPoint(parent, localX!, localY!, 0);

    check(
      'past 90 degrees the Z-only conversion lands the bone on the wrong side',
      Math.sign(naiveWorldX!) !== Math.sign(cursorWorldX),
      `naive landed at ${naiveWorldX}`,
    );
    check(
      'the full inverse lands the bone on the cursor side',
      Math.sign(fixedWorldX!) === Math.sign(cursorWorldX),
      `landed at ${fixedWorldX}`,
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

      // A rig that tilts has no meaningful scalar answer to compare against —
      // the scalar path cannot represent 3D rotation at all, so a difference
      // there measures nothing. Only 2D rigs are informative here.
      if (fixture.bones.some((b) => (b.rotationX ?? 0) !== 0 || (b.rotationY ?? 0) !== 0)) continue;

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

