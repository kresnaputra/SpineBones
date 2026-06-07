/**
 * Low-level WebGL helpers for the mesh renderer: context creation, the textured
 * shader program, and a premultiplied-alpha texture cache keyed by image data.
 *
 * Textures are uploaded premultiplied and drawn with `blendFunc(ONE,
 * ONE_MINUS_SRC_ALPHA)` — this avoids the dark edge fringing that straight-alpha
 * blending produces, which matters for the clean, seam-free look we want.
 */

const VERTEX_SRC = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec4 uTransform; // (ax, ay, bx, by): clip = pos * (ax,ay) + (bx,by)
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos.x * uTransform.x + uTransform.z, aPos.y * uTransform.y + uTransform.w, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uSampler;
uniform float uAlpha;
void main() {
  // Texture is premultiplied; scaling by uAlpha keeps it premultiplied.
  gl_FragColor = texture2D(uSampler, vUV) * uAlpha;
}
`;

export interface GLProgram {
  program: WebGLProgram;
  attribs: { aPos: number; aUV: number };
  uniforms: {
    uTransform: WebGLUniformLocation;
    uSampler: WebGLUniformLocation;
    uAlpha: WebGLUniformLocation;
  };
}

const compileShader = (gl: WebGLRenderingContext, type: number, src: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
};

export const createProgram = (gl: WebGLRenderingContext): GLProgram => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }

  const uTransform = gl.getUniformLocation(program, 'uTransform');
  const uSampler = gl.getUniformLocation(program, 'uSampler');
  const uAlpha = gl.getUniformLocation(program, 'uAlpha');
  if (!uTransform || !uSampler || !uAlpha) {
    throw new Error('Failed to resolve shader uniforms');
  }

  return {
    program,
    attribs: {
      aPos: gl.getAttribLocation(program, 'aPos'),
      aUV: gl.getAttribLocation(program, 'aUV'),
    },
    uniforms: { uTransform, uSampler, uAlpha },
  };
};

/**
 * Premultiplied-alpha texture cache. Textures live per GL context; if the
 * context is lost/recreated the whole cache is dropped via `clearTextureCache`.
 */
export class TextureCache {
  private readonly gl: WebGLRenderingContext;
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly loading = new Set<string>();

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
  }

  /**
   * Returns the texture for `imageData`, or null if it is still loading. When a
   * texture finishes loading `onReady` is invoked so the caller can re-render.
   */
  get(imageData: string, onReady?: () => void): WebGLTexture | null {
    const existing = this.textures.get(imageData);
    if (existing) return existing;
    if (this.loading.has(imageData)) return null;

    this.loading.add(imageData);
    const img = new Image();
    img.onload = () => {
      this.loading.delete(imageData);
      this.upload(imageData, img);
      onReady?.();
    };
    img.onerror = () => {
      this.loading.delete(imageData);
    };
    img.src = imageData;
    return null;
  }

  private upload(imageData: string, img: HTMLImageElement) {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textures.set(imageData, tex);
  }

  /** Drop a single texture (e.g. when an attachment image changes). */
  invalidate(imageData: string) {
    const tex = this.textures.get(imageData);
    if (tex) {
      this.gl.deleteTexture(tex);
      this.textures.delete(imageData);
    }
    this.loading.delete(imageData);
  }

  clear() {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
    this.textures.clear();
    this.loading.clear();
  }
}
