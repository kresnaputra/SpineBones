import type { Attachment, Bone, Slot } from '../../types';
import type { ViewportRect } from '../viewport';
import { getViewportEffectiveZoom } from '../viewport';
import { getAttachmentGeometry } from '../meshSkinning';
import { createProgram, TextureCache, type GLProgram } from './glContext';

/**
 * WebGL renderer for all textured attachments (plain images render as quads,
 * meshes as skinned triangle meshes). A single GL draw per attachment with
 * shared vertices means there are no internal clip seams — the artifact that
 * killed the Canvas-2D mesh implementation simply cannot occur here.
 *
 * The renderer is camera-agnostic: it receives world-space geometry from
 * `meshSkinning` and a world→clip transform derived from the shared viewport
 * math, so the live preview and the offscreen export path stay identical.
 */

/** One draw pass over the scene (main pass, or a dimmed onion-skin ghost). */
export interface ScenePass {
  bones: Bone[];
  alpha: number;
}

export interface SceneInput {
  slots: Slot[];
  attachments: Attachment[];
  passes: ScenePass[];
  camX: number;
  camY: number;
  camZoom: number;
  canvasWidth: number;
  canvasHeight: number;
  viewportRect: ViewportRect;
  /** Optional clip rect in canvas pixels (top-left origin); used for the viewport mask. */
  clip?: { x: number; y: number; width: number; height: number };
  /** Called when a texture finishes loading so the caller can re-render. */
  onTextureReady?: () => void;
}

export interface MeshRenderer {
  render: (scene: SceneInput) => void;
  /** Drop a cached texture (call when an attachment image changes). */
  invalidateTexture: (imageData: string) => void;
  dispose: () => void;
}

/** Build the (ax, ay, bx, by) world→clip transform shared with the export path. */
const computeTransform = (
  viewportRect: ViewportRect,
  camX: number,
  camY: number,
  camZoom: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] => {
  const ez = getViewportEffectiveZoom(viewportRect, camZoom);
  const cx = viewportRect.x + viewportRect.width / 2;
  const cy = viewportRect.y + viewportRect.height / 2;
  const ax = (2 * ez) / canvasWidth;
  const bx = ((cx - camX * ez) * 2) / canvasWidth - 1;
  const ay = (-2 * ez) / canvasHeight;
  const by = 1 - ((cy - camY * ez) * 2) / canvasHeight;
  return [ax, ay, bx, by];
};

export const createMeshRenderer = (gl: WebGLRenderingContext): MeshRenderer => {
  const glProgram: GLProgram = createProgram(gl);
  const textures = new TextureCache(gl);
  const posBuffer = gl.createBuffer()!;
  const uvBuffer = gl.createBuffer()!;
  const indexBuffer = gl.createBuffer()!;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  const drawAttachment = (
    attachment: Attachment,
    bone: Bone,
    allBones: Bone[],
    alpha: number,
    onReady?: () => void,
  ) => {
    if (!attachment.imageData) return;
    const tex = textures.get(attachment.imageData, onReady);
    if (!tex) return; // still loading

    const geo = getAttachmentGeometry(attachment, bone, allBones);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(glProgram.attribs.aPos);
    gl.vertexAttribPointer(glProgram.attribs.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.uvs, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(glProgram.attribs.aUV);
    gl.vertexAttribPointer(glProgram.attribs.aUV, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.DYNAMIC_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(glProgram.uniforms.uSampler, 0);
    gl.uniform1f(glProgram.uniforms.uAlpha, alpha * (attachment.opacity ?? 1));

    gl.drawElements(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_SHORT, 0);
  };

  const render = (scene: SceneInput) => {
    gl.viewport(0, 0, scene.canvasWidth, scene.canvasHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (scene.clip) {
      // GL scissor origin is bottom-left; flip the top-left rect's Y.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        scene.clip.x,
        scene.canvasHeight - (scene.clip.y + scene.clip.height),
        scene.clip.width,
        scene.clip.height,
      );
    }

    gl.useProgram(glProgram.program);
    const [ax, ay, bx, by] = computeTransform(
      scene.viewportRect,
      scene.camX,
      scene.camY,
      scene.camZoom,
      scene.canvasWidth,
      scene.canvasHeight,
    );
    gl.uniform4f(glProgram.uniforms.uTransform, ax, ay, bx, by);

    for (const pass of scene.passes) {
      for (const bone of pass.bones) {
        for (const slot of scene.slots) {
          if (slot.boneId !== bone.id || !slot.attachmentName) continue;
          const attachment = scene.attachments.find(
            (a) => a.slotId === slot.id && a.name === slot.attachmentName,
          );
          if (!attachment) continue;
          drawAttachment(attachment, bone, pass.bones, pass.alpha, scene.onTextureReady);
        }
      }
    }
  };

  const dispose = () => {
    textures.clear();
    gl.deleteBuffer(posBuffer);
    gl.deleteBuffer(uvBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteProgram(glProgram.program);
  };

  return { render, invalidateTexture: (d) => textures.invalidate(d), dispose };
};
