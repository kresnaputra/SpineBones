/**
 * Deterministic fixtures for the Phase A (matrix pipeline) parity harness.
 *
 * Every case here exists to pin down one branch that the 4x4-matrix rewrite of
 * `engine/transforms.ts` + `engine/meshSkinning.ts` could silently change. Keep
 * the numbers ugly and non-round on purpose: a refactor that drops a term is
 * invisible when every input is 0, 1 or 90.
 *
 * Bones mirror what `skeletonStore.addBone` produces, including seeding
 * `_wx/_wy/_wrot` from the local values — `computeAllWorldTransforms` reads
 * those stale seeds for non-root bones on its first pass, so the seeding is
 * part of the behaviour under test, not incidental setup.
 */

import type { Attachment, Bone, MeshTriangle, MeshVertex, MeshVertexWeight, Slot } from '../../src/types';

export interface FixtureAttachment {
  attachment: Attachment;
  /** Bone the attachment's slot hangs off. */
  boneId: number;
}

export interface FixtureCase {
  name: string;
  /**
   * True when the matrix rewrite is *expected* to change this case's output
   * (it fixes a latent bug). Such cases are reported but never fail the run.
   */
  expectChange: boolean;
  note: string;
  bones: Bone[];
  attachments: FixtureAttachment[];
  /**
   * Present only on cases that exercise draw ordering. When set, the harness
   * records the sequence the renderer would draw in, so Phase B can prove its
   * depth sort reproduces today's painter's order exactly at yaw 0.
   */
  slots?: Slot[];
}

interface BoneOpts {
  length?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /**
   * Override the `_wx/_wy/_wrot` seed. Real bones seed these from their local
   * values, but a bone whose parent was deleted keeps the *world* values it last
   * held — and the legacy loop never overwrites them again. Use this to
   * reproduce that state.
   */
  seed?: { wx: number; wy: number; wrot: number };
}

const makeBone = (
  id: number,
  name: string,
  parentId: number | null,
  x: number,
  y: number,
  opts: BoneOpts = {},
): Bone => {
  const rotation = opts.rotation ?? 0;
  return {
    id,
    name,
    x,
    y,
    length: opts.length ?? 50,
    rotation,
    scaleX: opts.scaleX ?? 1,
    scaleY: opts.scaleY ?? 1,
    parentId,
    skinId: 0,
    // Matches addBone: world fields start out holding the *local* values.
    _wx: opts.seed ? opts.seed.wx : x,
    _wy: opts.seed ? opts.seed.wy : y,
    _wrot: opts.seed ? opts.seed.wrot : rotation,
  };
};

interface AttachmentOpts {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  imageIsCropped?: boolean;
  opaqueBounds?: Attachment['opaqueBounds'];
  mesh?: Attachment['mesh'];
  vertexWeights?: MeshVertexWeight[][];
}

const makeAttachment = (
  name: string,
  slotId: number,
  type: Attachment['type'],
  width: number,
  height: number,
  opts: AttachmentOpts = {},
): Attachment => ({
  name,
  slotId,
  type,
  imagePath: `${name}.png`,
  width,
  height,
  x: opts.x ?? 0,
  y: opts.y ?? 0,
  rotation: opts.rotation ?? 0,
  scaleX: opts.scaleX ?? 1,
  scaleY: opts.scaleY ?? 1,
  opacity: opts.opacity,
  imageIsCropped: opts.imageIsCropped,
  opaqueBounds: opts.opaqueBounds,
  mesh: opts.mesh,
  vertexWeights: opts.vertexWeights,
});

/**
 * Grid mesh spanning the same rect the plain-image quad would cover, so mesh
 * and quad geometry stay directly comparable. `cols`/`rows` are cell counts.
 */
const makeGridMesh = (
  width: number,
  height: number,
  cols: number,
  rows: number,
): NonNullable<Attachment['mesh']> => {
  const vertices: MeshVertex[] = [];
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols;
      const v = r / rows;
      vertices.push({
        x: (u - 0.5) * width,
        y: (v - 0.5) * height,
        u,
        v,
      });
    }
  }

  const triangles: MeshTriangle[] = [];
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(a < b ? [a, b] : [b, a]);
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i00 = r * (cols + 1) + c;
      const i10 = i00 + 1;
      const i01 = i00 + (cols + 1);
      const i11 = i01 + 1;
      triangles.push([i00, i10, i11]);
      triangles.push([i00, i11, i01]);
      addEdge(i00, i10);
      addEdge(i10, i11);
      addEdge(i11, i01);
      addEdge(i01, i00);
      addEdge(i00, i11);
    }
  }

  return { vertices, triangles, edges, grid: { columns: cols, rows } };
};

/** Straight chain of `depth` bones, each rotated/scaled so error compounds. */
const makeChain = (depth: number): Bone[] => {
  const bones: Bone[] = [];
  for (let i = 0; i < depth; i += 1) {
    bones.push(
      makeBone(i, `chain_${i}`, i === 0 ? null : i - 1, i === 0 ? 17.5 : 41.25, i === 0 ? -23.75 : 13.5, {
        rotation: i === 0 ? 11.25 : 7.5,
        scaleX: i === 0 ? 1 : 1.05,
        scaleY: i === 0 ? 1 : 0.95,
      }),
    );
  }
  return bones;
};

export const buildFixtures = (): FixtureCase[] => {
  const cases: FixtureCase[] = [];

  // ---------------------------------------------------------------------------
  // 1. Root id 0 with a child whose parentId === 0.
  //    `transforms.ts:5` tests `!bone.parentId`, so parentId 0 is misread as
  //    "no parent". Harmless today only because the second loop overwrites it —
  //    the rewrite must use `=== null` and still land on identical numbers.
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'hip', null, 12.5, -34.75, { rotation: 23.5 }),
      makeBone(1, 'torso', 0, 47.25, 8.5, { rotation: -16.75, scaleX: 1.15, scaleY: 0.85 }),
      makeBone(2, 'head', 1, 33.5, -5.25, { rotation: 41.5 }),
    ];
    cases.push({
      name: 'root-id-zero',
      expectChange: false,
      note: 'child with parentId === 0 — the falsy-zero branch in computeAllWorldTransforms',
      bones,
      attachments: [
        { boneId: 1, attachment: makeAttachment('torso_img', 1, 'image', 128, 192, { x: 6.5, y: -11.25, rotation: 9.75 }) },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Negative scale on both bone and attachment (the flipX/flipY branch in
  //    meshSkinning `boneFrame`). Flip is applied about the attachment pivot,
  //    which is easy to lose when the transform moves into a matrix.
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'root', null, -8.25, 19.5, { rotation: -33.25 }),
      makeBone(1, 'arm_l', 0, 52.75, -14.5, { rotation: 27.5, scaleX: -1.2, scaleY: 1.1 }),
    ];
    cases.push({
      name: 'negative-scale-flip',
      expectChange: false,
      note: 'bone scaleX < 0 and attachment scaleY < 0 — flipX/flipY about the attachment pivot',
      bones,
      attachments: [
        { boneId: 1, attachment: makeAttachment('arm_img', 1, 'image', 96, 160, { x: -13.5, y: 7.25, rotation: -21.5, scaleX: 1.3, scaleY: -0.9 }) },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Cropped image: the stored asset is the opaque sub-rect, so the quad is
  //    positioned from `opaqueBounds` instead of centred on the attachment.
  //    (meshSkinning.ts:115 — only the quad path reads these fields.)
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'root', null, 5.5, -7.25, { rotation: 14.75 }),
      makeBone(1, 'prop', 0, 29.5, 36.25, { rotation: -8.5, scaleX: 0.9, scaleY: 1.4 }),
    ];
    cases.push({
      name: 'cropped-quad',
      expectChange: false,
      note: 'imageIsCropped + opaqueBounds quad placement',
      bones,
      attachments: [
        {
          boneId: 1,
          attachment: makeAttachment('prop_img', 1, 'image', 200, 150, {
            x: 11.25,
            y: -6.75,
            rotation: 5.5,
            scaleX: 1.1,
            scaleY: 1.25,
            imageIsCropped: true,
            opaqueBounds: { x: 23, y: 17, width: 141, height: 96 },
          }),
        },
        {
          // Same attachment without the crop, to catch a rewrite that applies
          // the cropped placement unconditionally.
          boneId: 1,
          attachment: makeAttachment('prop_img_uncropped', 1, 'image', 200, 150, {
            x: 11.25,
            y: -6.75,
            rotation: 5.5,
            scaleX: 1.1,
            scaleY: 1.25,
          }),
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Weighted mesh. Covers every branch of `skinVertex`:
  //      - >= 2 usable weights (the blend path)
  //      - a zero weight that must be skipped
  //      - a single-entry weights array (falls through to the rigid path)
  //      - a weight naming a bone id that does not exist (`?? bone` fallback)
  //      - an empty weights array
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'root', null, -3.75, 11.5, { rotation: 6.25 }),
      makeBone(1, 'spine', 0, 38.5, -9.75, { rotation: 18.5, scaleX: 1.08, scaleY: 0.92 }),
      makeBone(2, 'neck', 1, 44.25, 6.5, { rotation: -27.75, scaleX: 0.95, scaleY: 1.12 }),
    ];
    const mesh = makeGridMesh(140, 180, 2, 2); // 9 vertices
    const vertexWeights: MeshVertexWeight[][] = mesh.vertices.map((v, i) => {
      switch (i) {
        case 0:
          return []; // empty -> rigid fallback
        case 1:
          return [{ boneId: 2, weight: 1 }]; // single entry -> rigid fallback
        case 2:
          return [
            { boneId: 1, weight: 0.65 },
            { boneId: 2, weight: 0 }, // zero weight must be skipped
          ];
        case 3:
          return [
            { boneId: 1, weight: 0.4 },
            { boneId: 97, weight: 0.6 }, // unknown bone -> `?? bone` fallback
          ];
        default: {
          // Blend across all three bones, deliberately not summing to 1 so the
          // `total` normalisation actually does something.
          const t = (v.x + 70) / 140;
          return [
            { boneId: 0, weight: 0.2 },
            { boneId: 1, weight: 0.55 * (1 - t) },
            { boneId: 2, weight: 0.75 * t },
          ];
        }
      }
    });

    cases.push({
      name: 'mesh-weighted',
      expectChange: false,
      note: 'skinVertex weight blending incl. zero/unknown/short weight lists',
      bones,
      attachments: [
        {
          boneId: 2,
          attachment: makeAttachment('head_mesh', 1, 'mesh', 140, 180, {
            x: 8.75,
            y: -14.25,
            rotation: 12.5,
            scaleX: 1.15,
            scaleY: 0.88,
            mesh,
            vertexWeights,
          }),
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Mesh with no weights at all — must skin rigidly to the slot's own bone.
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'root', null, 21.5, -5.25, { rotation: -19.75 }),
      makeBone(1, 'cape', 0, 17.25, 48.5, { rotation: 34.5, scaleX: -1.05, scaleY: 1.15 }),
    ];
    cases.push({
      name: 'mesh-unweighted',
      expectChange: false,
      note: 'mesh with undefined vertexWeights — rigid fallback, negative bone scaleX',
      bones,
      attachments: [
        {
          boneId: 1,
          attachment: makeAttachment('cape_mesh', 1, 'mesh', 120, 210, {
            x: -9.5,
            y: 16.75,
            rotation: -7.25,
            scaleX: 0.95,
            scaleY: 1.2,
            mesh: makeGridMesh(120, 210, 3, 2),
          }),
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Rotation accumulating past 360 degrees.
  //    `_wrot` is an accumulated degree sum (`parent._wrot + bone.rotation`),
  //    NOT a normalised angle. Deriving it from a matrix via atan2 would wrap it
  //    to +/-180 and quietly move every getBoneTip / IK target. This case fails
  //    loudly if the rewrite does that.
  // ---------------------------------------------------------------------------
  {
    const bones = [
      makeBone(0, 'spinner_root', null, 4.25, -12.5, { rotation: 450 }),
      makeBone(1, 'spinner_mid', 0, 60.5, 3.25, { rotation: 270.5 }),
      makeBone(2, 'spinner_tip', 1, 35.75, -8.5, { rotation: -540.25 }),
    ];
    cases.push({
      name: 'rotation-beyond-360',
      expectChange: false,
      note: '_wrot accumulates unnormalised degrees — must not be re-derived via atan2',
      bones,
      attachments: [
        { boneId: 2, attachment: makeAttachment('spin_img', 1, 'image', 80, 80, { rotation: 33.25 }) },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Deep hierarchy, array already in topological order.
  //    One pass is enough here, so the current 5-pass loop is already correct
  //    and the rewrite must match it exactly.
  // ---------------------------------------------------------------------------
  cases.push({
    name: 'deep-chain-ordered',
    expectChange: false,
    note: '7-level chain, parents before children — current code already correct',
    bones: makeChain(7),
    attachments: [
      { boneId: 6, attachment: makeAttachment('tip_img', 1, 'image', 64, 64, { rotation: 4.5 }) },
    ],
  });

  // ---------------------------------------------------------------------------
  // 8. Same 7-level chain, array order reversed.
  //    The current loop propagates exactly one level per pass when children
  //    precede parents, so with 5 passes the deepest bones are WRONG today.
  //    A topological rewrite fixes it — this case is expected to change, and a
  //    change here is the fix landing, not a regression.
  // ---------------------------------------------------------------------------
  cases.push({
    name: 'deep-chain-shuffled',
    expectChange: true,
    note: '7-level chain, children before parents — exceeds the 5-pass budget (known latent bug)',
    bones: makeChain(7).reverse(),
    attachments: [
      { boneId: 6, attachment: makeAttachment('tip_img', 1, 'image', 64, 64, { rotation: 4.5 }) },
    ],
  });

  // ---------------------------------------------------------------------------
  // 9. Orphaned bone — parentId points at a bone that is not in the array.
  //    Reachable in the real editor: `skeletonStore.deleteBone` removes the bone
  //    and its *direct* children, so any grandchildren survive pointing at a
  //    parent that no longer exists.
  //
  //    Today such a bone keeps whatever `_wx/_wy/_wrot` it last held — the first
  //    loop skips it (parentId is truthy) and the second returns early when the
  //    parent lookup fails — so it freezes in place and stops responding to its
  //    own x/y/rotation for good. The seeds below reproduce that frozen state.
  //    A topological rewrite treats an unresolvable parent as "no parent", which
  //    is deterministic and matches how a parentId of 0 already behaves.
  // ---------------------------------------------------------------------------
  cases.push({
    name: 'orphan-dangling-parent',
    expectChange: true,
    note: 'bone whose parent was deleted — legacy freezes it at stale world values (known latent bug)',
    bones: [
      makeBone(0, 'root', null, 6.5, -14.25, { rotation: 12.5 }),
      makeBone(1, 'orphan', 42, 31.75, 9.5, {
        rotation: -21.25,
        seed: { wx: 188.25, wy: -73.5, wrot: 137.75 },
      }),
    ],
    attachments: [
      { boneId: 1, attachment: makeAttachment('orphan_img', 1, 'image', 72, 96, { rotation: 3.25 }) },
    ],
  });

  // ---------------------------------------------------------------------------
  // 10. Draw order.
  //
  //   Today's order is decided by `meshRenderer.render`'s nested loop:
  //   bone array order on the outside, slot array order on the inside. Bone
  //   array order is what the Bones panel's drag-and-drop reorders, and slot
  //   array order is kept equal to `drawOrder` by `slotStore.reorderSlots`.
  //   So neither `bone.id` nor `slot.id` decides anything — position does.
  //
  //   The array orders below are deliberately NOT id order, and the case
  //   includes both skip branches: a slot with no attachment name, and a slot
  //   naming an attachment that does not exist.
  // ---------------------------------------------------------------------------
  {
    const bones = [
      // Array order 2, 0, 1 — deliberately not id order.
      makeBone(2, 'arm_front', 0, 41.5, -8.25, { rotation: 14.5 }),
      makeBone(0, 'torso', null, 9.75, -21.5, { rotation: 7.25 }),
      makeBone(1, 'arm_back', 0, -37.25, 11.5, { rotation: -19.75 }),
    ];

    const slot = (id: number, name: string, boneId: number, attachmentName: string | null, drawOrder: number): Slot => ({
      id,
      name,
      boneId,
      color: '#888888',
      attachmentName,
      drawOrder,
    });

    const slots = [
      slot(10, 'back_hand', 1, 'back_hand_img', 0),
      slot(11, 'body', 0, 'body_img', 1),
      slot(12, 'empty', 0, null, 2),               // no attachment name -> skipped
      slot(13, 'ghost', 0, 'missing_img', 3),      // names an attachment that does not exist -> skipped
      slot(14, 'front_hand', 2, 'front_hand_img', 4),
      slot(15, 'badge', 0, 'badge_img', 5),
    ];

    cases.push({
      name: 'draw-order',
      expectChange: false,
      note: "renderer draw sequence: bone array order outside, slot array order inside",
      bones,
      slots,
      attachments: [
        { boneId: 1, attachment: { ...makeAttachment('back_hand_img', 10, 'image', 48, 48), slotId: 10 } },
        { boneId: 0, attachment: { ...makeAttachment('body_img', 11, 'image', 120, 160), slotId: 11 } },
        { boneId: 2, attachment: { ...makeAttachment('front_hand_img', 14, 'image', 48, 48), slotId: 14 } },
        { boneId: 0, attachment: { ...makeAttachment('badge_img', 15, 'image', 32, 32), slotId: 15 } },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // 11. Slots whose array order disagrees with their `drawOrder`.
  //
  //   `slotStore` keeps the two in step (`reorderSlots` re-sorts the array), so
  //   the renderer's inner loop gets the same answer either way and case 10
  //   cannot tell them apart. That equivalence is an invariant of the store, not
  //   of the renderer — and the moment per-slot depth becomes editable it could
  //   stop holding. This case pins down which one the renderer actually follows,
  //   so a future divergence surfaces here instead of as a mis-layered rig.
  // ---------------------------------------------------------------------------
  {
    const bones = [makeBone(0, 'torso', null, 3.5, -9.25, { rotation: 8.75 })];

    const slot = (id: number, name: string, attachmentName: string, drawOrder: number) => ({
      id,
      name,
      boneId: 0,
      color: '#888888',
      attachmentName,
      drawOrder,
    });

    // Array order a, b, c — but drawOrder says c, b, a.
    const slots = [
      slot(20, 'first_in_array', 'a_img', 2),
      slot(21, 'second_in_array', 'b_img', 1),
      slot(22, 'third_in_array', 'c_img', 0),
    ];

    cases.push({
      name: 'draw-order-array-vs-draworder',
      expectChange: false,
      note: 'slot array order deliberately disagrees with drawOrder — pins which one the renderer follows',
      bones,
      slots,
      attachments: [
        { boneId: 0, attachment: { ...makeAttachment('a_img', 20, 'image', 40, 40), slotId: 20 } },
        { boneId: 0, attachment: { ...makeAttachment('b_img', 21, 'image', 40, 40), slotId: 21 } },
        { boneId: 0, attachment: { ...makeAttachment('c_img', 22, 'image', 40, 40), slotId: 22 } },
      ],
    });
  }

  return cases;
};
