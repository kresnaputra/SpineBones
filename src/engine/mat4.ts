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

/**
 * The world->clip transform the renderer already uses, expressed as a matrix.
 *
 * `(ax, ay, bx, by)` comes from `meshRenderer.computeTransform`; the shader
 * currently evaluates `pos.xy * (ax, ay) + (bx, by)`. Multiplying by this matrix
 * adds only exact-zero terms to those same products, so the result is unchanged
 * — which is what makes the Phase A shader swap verifiable rather than hopeful.
 *
 * Z passes through untouched: nothing writes a non-zero Z yet, and depth is
 * Phase B's problem.
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
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = bx; out[13] = by; out[14] = 0; out[15] = 1;
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
