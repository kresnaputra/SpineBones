/**
 * Minimal 4x4 matrix maths for the skeleton transform pipeline.
 *
 * Column-major, matching what `uniformMatrix4fv` expects:
 *
 *   m[0] m[4] m[8]  m[12]
 *   m[1] m[5] m[9]  m[13]
 *   m[2] m[6] m[10] m[14]
 *   m[3] m[7] m[11] m[15]
 *
 * ## Why Float64Array
 *
 * Bone world matrices never reach the GPU — `meshSkinning` bakes geometry into
 * world space on the CPU and the renderer uploads plain positions, with only the
 * world->clip matrix travelling as a uniform. Storing matrices as float32 would
 * therefore buy nothing and cost precision: the legacy scalar formula in
 * `transforms.ts` computes in float64, so a float32 matrix could not reproduce
 * its `_wx`/`_wy` exactly, and Phase A parity would fail for no good reason.
 *
 * Conversion to float32 happens exactly once, at the GPU boundary, via
 * `toFloat32`. That is a real, deliberate quantisation — see the note there.
 *
 * ## What is deliberately missing
 *
 * There is no rotation-extraction helper (no `decompose`). `Bone._wrot` is an
 * *accumulated, unnormalised* degree sum — `parent._wrot + bone.rotation`, which
 * legitimately runs past +/-360 and is read back by `getBoneTip` and the IK
 * solver. Recovering it with `atan2` would silently wrap it into +/-180 and move
 * every bone tip on rigs that spin more than a full turn. Rotation must keep
 * being accumulated as a scalar alongside the matrix, never read out of it.
 */

/** Column-major 4x4 matrix. */
export type Mat4 = Float64Array;

/** A matrix that can be read but not necessarily written (accepts float32 too). */
export type ReadonlyMat4 = ArrayLike<number>;

export const create = (): Mat4 => new Float64Array(16);

export const identity = (out: Mat4 = create()): Mat4 => {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
};

export const copy = (src: ReadonlyMat4, out: Mat4 = create()): Mat4 => {
  for (let i = 0; i < 16; i += 1) out[i] = src[i]!;
  return out;
};

/**
 * `out = a * b` — b applied first, then a, the usual parent-then-child order.
 * Safe when `out` aliases `a` or `b`.
 */
export const multiply = (a: ReadonlyMat4, b: ReadonlyMat4, out: Mat4 = create()): Mat4 => {
  const aliased = (out as ReadonlyMat4) === a || (out as ReadonlyMat4) === b;
  const dst = aliased ? create() : out;

  for (let col = 0; col < 4; col += 1) {
    const b0 = b[col * 4]!;
    const b1 = b[col * 4 + 1]!;
    const b2 = b[col * 4 + 2]!;
    const b3 = b[col * 4 + 3]!;
    for (let row = 0; row < 4; row += 1) {
      dst[col * 4 + row] =
        a[row]! * b0 + a[4 + row]! * b1 + a[8 + row]! * b2 + a[12 + row]! * b3;
    }
  }

  return aliased ? copy(dst, out) : dst;
};

const DEG2RAD = Math.PI / 180;

/**
 * Rigid frame `T(tx, ty) * Rz(rotationDeg)` — translate, then rotate about Z.
 *
 * Scale is deliberately absent. In the current skeleton model a bone's scale is
 * *not* part of its world frame: `transforms.ts` applies the parent's scale to
 * the child's local offset only (one level, never accumulated down the chain),
 * and `meshSkinning.boneFrame` reads the bone's own scale directly when placing
 * an attachment. Folding scale into this matrix would change both behaviours.
 * Callers pre-scale `tx`/`ty` themselves, exactly as the legacy code does.
 */
export const fromTranslationRotationZ = (
  tx: number,
  ty: number,
  rotationDeg: number,
  out: Mat4 = create(),
): Mat4 => {
  const r = rotationDeg * DEG2RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);

  out[0] = cos; out[1] = sin; out[2] = 0; out[3] = 0;
  out[4] = -sin; out[5] = cos; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = tx; out[13] = ty; out[14] = 0; out[15] = 1;
  return out;
};

export const fromTranslation = (
  tx: number,
  ty: number,
  tz: number,
  out: Mat4 = create(),
): Mat4 => {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
  return out;
};

/** Rotation about the X axis — camera pitch. Exactly identity at 0 degrees. */
export const fromRotationX = (deg: number, out: Mat4 = create()): Mat4 => {
  const r = deg * DEG2RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = cos; out[6] = sin; out[7] = 0;
  out[8] = 0; out[9] = -sin; out[10] = cos; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
};

/** Rotation about the Y axis — camera yaw. Exactly identity at 0 degrees. */
export const fromRotationY = (deg: number, out: Mat4 = create()): Mat4 => {
  const r = deg * DEG2RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  out[0] = cos; out[1] = 0; out[2] = -sin; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = sin; out[9] = 0; out[10] = cos; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
};

/**
 * Orbit the scene around the camera's focus point:
 *
 *   T(focus) * Ry(yaw) * Rx(pitch) * T(-focus)
 *
 * Pre-multiply the existing `ortho2D` by this and the camera turns around what
 * it is looking at, instead of around the world origin.
 *
 * ## It is exactly the identity at yaw 0, pitch 0
 *
 * That is the whole reason it is built this way rather than by folding the
 * camera offset into the projection. Every step is exact at zero: `cos(0)` is
 * 1 and `sin(0)` is 0, so both rotations are literally the identity matrix;
 * multiplying identities adds only exact zeros; and `T(f) * T(-f)` lands on a
 * translation of `f + (-f)`, which is exactly 0 in floating point. So
 * `ortho2D * orbitTransform(..., 0, 0)` reproduces `ortho2D` bit for bit, and
 * the parity harness holds to its exact-zero tolerance.
 *
 * Decomposing the projection instead — `ax * (wx - camX) + ...` — would be the
 * obvious approach and is mathematically identical, but it reassociates the
 * arithmetic and lands about an ulp away from the legacy formula.
 */
export const orbitTransform = (
  focusX: number,
  focusY: number,
  yawDeg: number,
  pitchDeg: number,
  out: Mat4 = create(),
): Mat4 => {
  const rotation = multiply(fromRotationY(yawDeg), fromRotationX(pitchDeg));
  const centred = multiply(rotation, fromTranslation(-focusX, -focusY, 0));
  return multiply(fromTranslation(focusX, focusY, 0), centred, out);
};

/**
 * The exact inverse of `orbitTransform`.
 *
 * A rotation's inverse is its transpose, and negating both angles in reverse
 * order gives exactly that, so this needs no general matrix inversion:
 *
 *   T(focus) * Rx(-pitch) * Ry(-yaw) * T(-focus)
 *
 * Exactly the identity at yaw 0 / pitch 0, for the same reasons `orbitTransform`
 * is — which is what lets the screen->world path stay bit-identical at rest.
 */
export const orbitTransformInverse = (
  focusX: number,
  focusY: number,
  yawDeg: number,
  pitchDeg: number,
  out: Mat4 = create(),
): Mat4 => {
  const rotation = multiply(fromRotationX(-pitchDeg), fromRotationY(-yawDeg));
  const centred = multiply(rotation, fromTranslation(-focusX, -focusY, 0));
  return multiply(fromTranslation(focusX, focusY, 0), centred, out);
};

/**
 * How well-conditioned unprojection onto the z = constant plane is, from 0 to 1.
 *
 * Solving a screen ray against that plane divides by the inverse orbit's (2,2)
 * element, which works out to `cos(yaw) * cos(pitch)`. As the plane turns
 * edge-on that goes to zero and a one-pixel mouse move maps to an unbounded
 * world distance — the same degeneracy the painter's sort hits, arrived at from
 * the other direction.
 */
export const orbitPlaneConditioning = (yawDeg: number, pitchDeg: number): number =>
  Math.abs(Math.cos(yawDeg * DEG2RAD) * Math.cos(pitchDeg * DEG2RAD));

/**
 * The world->clip transform the renderer already uses, expressed as a matrix.
 *
 * `(ax, ay, bx, by)` comes from `meshRenderer.computeTransform`; the shader
 * currently evaluates `pos.xy * (ax, ay) + (bx, by)`. Multiplying by this matrix
 * adds only exact-zero terms to those same products, so the result is unchanged
 * — which is what makes the Phase A shader swap verifiable rather than hopeful.
 *
 * ## Clip Z is forced to 0, deliberately
 *
 * WebGL discards any vertex outside `-w <= z <= w`, and w is 1 here. Letting
 * world Z through (`m[10] = 1`) would therefore clip away every layer more than
 * one unit deep — the whole rig past the first sprite would simply vanish. The
 * shader this replaced hardcoded `gl_Position = vec4(x, y, 0.0, 1.0)`, and that
 * is exactly the behaviour preserved here.
 *
 * Depth is resolved on the CPU by sorting (see `drawOrder`), not by a depth
 * buffer — `DEPTH_TEST` is off, because alpha blending needs painter's order.
 * Z still matters on the way in: once the camera orbits, the rotation mixes
 * world Z into clip X and Y. It is only the Z *output* that is discarded.
 */
export const ortho2D = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: Mat4 = create(),
): Mat4 => {
  out[0] = ax; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = ay; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 0; out[11] = 0;
  out[12] = bx; out[13] = by; out[14] = 0; out[15] = 1;
  return out;
};

/**
 * Inverse of a rigid transform — rotation plus translation, no scale.
 *
 * A rotation's inverse is its transpose, so this needs no general inversion:
 * transpose the upper-left 3x3, then negate the translation through it. Every
 * frame this codebase builds is rigid (scale is applied separately, by the
 * caller), so this is always the right inverse to use.
 */
export const invertRigid = (m: ReadonlyMat4, out: Mat4 = create()): Mat4 => {
  const tx = m[12]!;
  const ty = m[13]!;
  const tz = m[14]!;

  out[0] = m[0]!; out[1] = m[4]!; out[2] = m[8]!; out[3] = 0;
  out[4] = m[1]!; out[5] = m[5]!; out[6] = m[9]!; out[7] = 0;
  out[8] = m[2]!; out[9] = m[6]!; out[10] = m[10]!; out[11] = 0;
  out[12] = -(m[0]! * tx + m[1]! * ty + m[2]! * tz);
  out[13] = -(m[4]! * tx + m[5]! * ty + m[6]! * tz);
  out[14] = -(m[8]! * tx + m[9]! * ty + m[10]! * tz);
  out[15] = 1;
  return out;
};

/**
 * Transform a point (implicit w = 1), ignoring any perspective row.
 * Accepts a float32 matrix so callers can measure what the GPU actually sees.
 *
 * ## Why the translation is added first
 *
 * Float addition is not associative, so the accumulation order is part of the
 * contract, not a stylistic choice. The legacy code this must reproduce reads:
 *
 *     wx = tx + lx*cos - ly*sin
 *
 * i.e. translation, then the rotated terms. Accumulating the rotated terms first
 * and adding the translation last — the conventional way to write this — lands
 * one ulp away (measured: 3.6e-15 on the Phase A fixtures), which is small but
 * not zero, and Phase A's whole premise is an exact-zero tolerance.
 *
 * Ordering it this way also leaves the clip case exact: `bx + ax*x` and
 * `x*ax + bx` are identical, since float addition *is* commutative.
 */
export const transformPoint = (
  m: ReadonlyMat4,
  x: number,
  y: number,
  z: number,
): [number, number, number] => [
  m[12]! + m[0]! * x + m[4]! * y + m[8]! * z,
  m[13]! + m[1]! * x + m[5]! * y + m[9]! * z,
  m[14]! + m[2]! * x + m[6]! * y + m[10]! * z,
];

/** Translation column of a matrix — the world position of the frame's origin. */
export const getTranslation = (m: ReadonlyMat4): [number, number, number] => [
  m[12]!,
  m[13]!,
  m[14]!,
];

/**
 * Narrow to float32 for `uniformMatrix4fv`, which accepts no wider type.
 *
 * This is the one place precision is dropped, and it is not new: the `uniform4f`
 * call this replaced quantised the very same coefficients. Pass a reusable `out`
 * from render code so this does not allocate per frame.
 */
export const toFloat32 = (m: ReadonlyMat4, out: Float32Array = new Float32Array(16)): Float32Array => {
  for (let i = 0; i < 16; i += 1) out[i] = m[i]!;
  return out;
};
