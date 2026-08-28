import JSZip from 'jszip';
import { drawSlots, loadImage } from '../engine/imageRenderer';
import { computeAllWorldTransforms } from '../engine/transforms';
import { useAnimationStore } from '../stores/animationStore';
import { useCameraStore } from '../stores/cameraStore';
import { useDeformerStore } from '../stores/deformerStore';
import { useEditorStore } from '../stores/editorStore';
import { usePhysicsStore } from '../stores/physicsStore';
import { useHistoryStore } from '../stores/historyStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useSlotStore } from '../stores/slotStore';
import type {
  Attachment,
  AudioTrack,
  Bone,
  MeshTriangle,
  MeshVertex,
  MeshVertexWeight,
  ProjectData,
  SetupPose,
} from '../types';
import { buildMeshEdges } from './meshAttachment';
import {
  getFileNameFromPath,
  openBinaryFile,
  readBinaryFileAtPath,
  saveBlobFile,
  stripExtension,
} from './nativeIO';
import { rememberRecentProject } from './recentProjects';

const PROJECT_ARCHIVE_EXTENSION = 'sbn';
const PROJECT_JSON_FILE_NAME = 'project.json';
const PROJECT_ACCEPT = `.${PROJECT_ARCHIVE_EXTENSION},application/zip`;

const PROJECT_FILTERS = [
  {
    name: 'SpineBones Project',
    extensions: [PROJECT_ARCHIVE_EXTENSION],
  },
];

type ProjectArchiveManifest = {
  app: 'SpineBones';
  version: string;
  format: 'project-archive';
  archiveVersion: '2.0';
  projectFile: string;
  assetsDir: string;
  thumbnailFile: string;
  createdAt: string;
};

export type ProjectPreview = {
  path: string;
  name: string;
  format: 'package' | 'legacy-json';
  projectVersion: string;
  archiveVersion: string | null;
  thumbnailDataUrl: string | null;
  updatedAt: string | null;
};

type ArchiveAttachment = Attachment & {
  assetPath?: string;
};

type ArchiveAudioTrack = Omit<AudioTrack, 'dataUrl'> & {
  dataUrl?: string | null;
  assetPath?: string | null;
};

type ArchiveProjectData = Omit<ProjectData, 'attachments' | 'audioTracks'> & {
  attachments: ArchiveAttachment[];
  audioTracks?: ArchiveAudioTrack[];
  backgroundAssetPath?: string | null;
  audioAssetPath?: string | null;
};

const isJsonProjectPath = (path: string | null | undefined) =>
  (path ?? '').toLowerCase().endsWith('.json');
const isSbnProjectPath = (path: string | null | undefined) =>
  (path ?? '').toLowerCase().endsWith(`.${PROJECT_ARCHIVE_EXTENSION}`);

const sanitizeFileSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'asset';

const getExtensionFromMimeType = (mimeType: string) => {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/wav') return 'wav';
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/mp4') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';
  if (normalized === 'audio/webm') return 'webm';
  return 'bin';
};

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) {
    throw new Error('Invalid data URL in project asset');
  }

  const [, mimeType, , payload] = match;
  const binary =
    typeof atob === 'function'
      ? atob(payload)
      : Buffer.from(payload, 'base64').toString('binary');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return {
    mimeType,
    bytes,
    extension: getExtensionFromMimeType(mimeType),
  };
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return `data:${mimeType};base64,${base64}`;
};

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for crop'));
    img.src = src;
  });

const cropAttachmentImage = async (
  imageData: string,
  existingOpaqueBounds: Attachment['opaqueBounds'],
): Promise<{ imageData: string; opaqueBounds: NonNullable<Attachment['opaqueBounds']> } | null> => {
  const img = await loadImageElement(imageData);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  let ox: number, oy: number, cw: number, ch: number;

  if (existingOpaqueBounds && existingOpaqueBounds.width > 0 && existingOpaqueBounds.height > 0) {
    ox = existingOpaqueBounds.x;
    oy = existingOpaqueBounds.y;
    cw = existingOpaqueBounds.width;
    ch = existingOpaqueBounds.height;
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, W, H);

    let oxMin = W, oyMin = H, oxMax = -1, oyMax = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 0) {
          if (x < oxMin) oxMin = x;
          if (y < oyMin) oyMin = y;
          if (x > oxMax) oxMax = x;
          if (y > oyMax) oyMax = y;
        }
      }
    }
    if (oxMax < oxMin || oyMax < oyMin) return null;
    ox = oxMin;
    oy = oyMin;
    cw = oxMax - oxMin + 1;
    ch = oyMax - oyMin + 1;
  }

  if (cw >= W && ch >= H) return null;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cw;
  cropCanvas.height = ch;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = W;
  srcCanvas.height = H;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return null;
  srcCtx.drawImage(img, 0, 0);
  cropCtx.drawImage(srcCanvas, ox, oy, cw, ch, 0, 0, cw, ch);

  return {
    imageData: cropCanvas.toDataURL('image/png'),
    opaqueBounds: { x: ox, y: oy, width: cw, height: ch },
  };
};

const blobToDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });

const readProjectPreview = async (
  bytes: Uint8Array,
  fileName: string,
  path: string,
): Promise<ProjectPreview> => {
  if (fileName.toLowerCase().endsWith('.json')) {
    const text = new TextDecoder().decode(bytes);
    const project = JSON.parse(text) as Partial<ProjectData>;
    return {
      path,
      name: getFileNameFromPath(path),
      format: 'legacy-json',
      projectVersion: project.version ?? '1.0',
      archiveVersion: null,
      thumbnailDataUrl: null,
      updatedAt: null,
    };
  }

  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('Project archive is missing manifest.json');
  }

  const manifest = JSON.parse(await manifestEntry.async('string')) as ProjectArchiveManifest;
  let thumbnailDataUrl: string | null = null;
  if (manifest.thumbnailFile) {
    const thumbnailEntry = zip.file(manifest.thumbnailFile);
    if (thumbnailEntry) {
      thumbnailDataUrl = bytesToDataUrl(
        await thumbnailEntry.async('uint8array'),
        getMimeTypeFromAssetPath(manifest.thumbnailFile),
      );
    }
  }

  return {
    path,
    name: getFileNameFromPath(path),
    format: 'package',
    projectVersion: manifest.version,
    archiveVersion: manifest.archiveVersion,
    thumbnailDataUrl,
    updatedAt: manifest.createdAt ?? null,
  };
};

const getMimeTypeFromAssetPath = (assetPath: string) => {
  const extension = assetPath.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'aac') return 'audio/aac';
  if (extension === 'webm') return 'audio/webm';
  return 'application/octet-stream';
};

const getAttachmentWorldBounds = (attachment: Attachment, bone: Bone) => {
  const rotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;
  const width = attachment.width * Math.abs(attachment.scaleX * bone.scaleX) * 0.5;
  const height = attachment.height * Math.abs(attachment.scaleY * bone.scaleY) * 0.5;
  const offsetX = attachment.x;
  const offsetY = attachment.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centerX = bone._wx + offsetX * cos - offsetY * sin;
  const centerY = bone._wy + offsetX * sin + offsetY * cos;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((corner) => ({
    x: centerX + corner.x * cos - corner.y * sin,
    y: centerY + corner.x * sin + corner.y * cos,
  }));

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
};

const renderProjectThumbnail = async (projectData: ProjectData) => {
  const size = 384;
  const padding = 0.82;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get thumbnail canvas context');
  }

  const attachmentSources = [
    ...projectData.attachments.map((attachment) => attachment.imageData).filter(Boolean),
    projectData.backgroundImage ?? undefined,
  ].filter(Boolean) as string[];
  await Promise.all(attachmentSources.map((source) => loadImage(source)));

  const bones = JSON.parse(JSON.stringify(projectData.bones)) as ProjectData['bones'];
  computeAllWorldTransforms(bones);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  projectData.slots.forEach((slot) => {
    if (!slot.attachmentName) return;
    const attachment = projectData.attachments.find(
      (item) => item.slotId === slot.id && item.name === slot.attachmentName,
    );
    if (!attachment) return;
    const bone = bones.find((item) => item.id === slot.boneId);
    if (!bone) return;
    const bounds = getAttachmentWorldBounds(attachment, bone);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    minX = -100;
    maxX = 100;
    minY = -100;
    maxY = 100;
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const zoom = Math.min((size * padding) / contentWidth, (size * padding) / contentHeight);
  const centerX = minX + contentWidth / 2;
  const centerY = minY + contentHeight / 2;

  if (projectData.backgroundImage) {
    const bg = await loadImage(projectData.backgroundImage);
    const scale = Math.max(size / bg.width, size / bg.height);
    const drawWidth = bg.width * scale;
    const drawHeight = bg.height * scale;
    ctx.drawImage(
      bg,
      (size - drawWidth) / 2,
      (size - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#121221');
    gradient.addColorStop(1, '#1b1b30');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const worldToScreen = (x: number, y: number) => ({
    x: size / 2 + (x - centerX) * zoom,
    y: size / 2 + (y - centerY) * zoom,
  });

  drawSlots(ctx, projectData.slots, projectData.attachments, bones, worldToScreen, zoom);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode project thumbnail'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
};

const createCachedProjectPreview = async (
  projectData: ProjectData,
  path: string,
): Promise<ProjectPreview> => {
  const isLegacyJson = path.toLowerCase().endsWith('.json');
  return {
    path,
    name: getFileNameFromPath(path),
    format: isLegacyJson ? 'legacy-json' : 'package',
    projectVersion: projectData.version,
    archiveVersion: isLegacyJson ? null : '2.0',
    thumbnailDataUrl: isLegacyJson ? null : await blobToDataUrl(await renderProjectThumbnail(projectData)),
    updatedAt: new Date().toISOString(),
  };
};

const serializeProjectArchive = async (projectData: ProjectData) => {
  const zip = new JSZip();
  const manifest: ProjectArchiveManifest = {
    app: 'SpineBones',
    version: projectData.version,
    format: 'project-archive',
    archiveVersion: '2.0',
    projectFile: PROJECT_JSON_FILE_NAME,
    assetsDir: 'assets',
    thumbnailFile: 'thumbnails/preview.png',
    createdAt: new Date().toISOString(),
  };

  const assetPathByDataUrl = new Map<string, string>(); // original imageData → assetPath
  const cropInfoByDataUrl = new Map<string, NonNullable<Attachment['opaqueBounds']> | null>(); // original imageData → opaqueBounds if cropped
  let assetIndex = 0;
  const createAssetPath = (baseName: string, extension: string) =>
    `${manifest.assetsDir}/${String(++assetIndex).padStart(4, '0')}-${sanitizeFileSegment(baseName)}.${extension}`;

  const processedAttachments: ArchiveAttachment[] = [];
  for (const attachment of projectData.attachments) {
    const nextAttachment: ArchiveAttachment = { ...attachment };
    // Mesh attachments are never crop-archived (see below) — clear a stale flag from
    // a project saved before this fix, or the stored (actually full-size) image would
    // be wrongly treated as pre-cropped on the next load.
    if (attachment.type === 'mesh' && nextAttachment.imageIsCropped) {
      nextAttachment.imageIsCropped = false;
    }

    if (attachment.imageData) {
      const originalImageData = attachment.imageData;

      if (assetPathByDataUrl.has(originalImageData)) {
        nextAttachment.assetPath = assetPathByDataUrl.get(originalImageData)!;
        const cachedOpaqueBounds = cropInfoByDataUrl.get(originalImageData);
        if (cachedOpaqueBounds) {
          nextAttachment.opaqueBounds = cachedOpaqueBounds;
          nextAttachment.imageIsCropped = true;
        }
      } else {
        let imageDataToStore = originalImageData;

        // Mesh vertex UVs are baked against the *original* image's pixel space and
        // the mesh renderer has no notion of `opaqueBounds`/`imageIsCropped` (only
        // the plain-image quad path reads those), so cropping a mesh's source image
        // here would silently shift every UV to sample the wrong texture region.
        const cropped =
          attachment.type === 'mesh'
            ? null
            : await cropAttachmentImage(originalImageData, attachment.opaqueBounds);
        if (cropped) {
          imageDataToStore = cropped.imageData;
          nextAttachment.opaqueBounds = cropped.opaqueBounds;
          nextAttachment.imageIsCropped = true;
          cropInfoByDataUrl.set(originalImageData, cropped.opaqueBounds);
        } else {
          cropInfoByDataUrl.set(originalImageData, null);
        }

        const parsed = parseDataUrl(imageDataToStore);
        const assetPath = createAssetPath(
          `${attachment.slotId}-${attachment.name || 'attachment'}`,
          parsed.extension,
        );
        assetPathByDataUrl.set(originalImageData, assetPath);
        zip.file(assetPath, parsed.bytes);
        nextAttachment.assetPath = assetPath;
      }

      delete nextAttachment.imageData;
    }

    processedAttachments.push(nextAttachment);
  }

  const archiveProject: ArchiveProjectData = {
    ...projectData,
    attachments: processedAttachments,
  };

  if (projectData.backgroundImage) {
    const existingAssetPath = assetPathByDataUrl.get(projectData.backgroundImage);
    archiveProject.backgroundAssetPath = existingAssetPath ?? createAssetPath('background', parseDataUrl(projectData.backgroundImage).extension);
    if (!existingAssetPath) {
      const parsed = parseDataUrl(projectData.backgroundImage);
      zip.file(archiveProject.backgroundAssetPath, parsed.bytes);
      assetPathByDataUrl.set(projectData.backgroundImage, archiveProject.backgroundAssetPath);
    }
    archiveProject.backgroundImage = null;
  }

  if (projectData.audioData) {
    const existingAssetPath = assetPathByDataUrl.get(projectData.audioData);
    archiveProject.audioAssetPath =
      existingAssetPath ??
      createAssetPath(
        projectData.audioName || 'audio-track',
        parseDataUrl(projectData.audioData).extension,
      );
    if (!existingAssetPath) {
      const parsed = parseDataUrl(projectData.audioData);
      zip.file(archiveProject.audioAssetPath, parsed.bytes);
      assetPathByDataUrl.set(projectData.audioData, archiveProject.audioAssetPath);
    }
    archiveProject.audioData = null;
  }

  if (projectData.audioTracks?.length) {
    archiveProject.audioTracks = projectData.audioTracks.map((track) => {
      const existingAssetPath = assetPathByDataUrl.get(track.dataUrl);
      const assetPath =
        existingAssetPath ??
        createAssetPath(
          `${track.id}-${track.name || 'audio-track'}`,
          parseDataUrl(track.dataUrl).extension,
        );
      if (!existingAssetPath) {
        const parsed = parseDataUrl(track.dataUrl);
        zip.file(assetPath, parsed.bytes);
        assetPathByDataUrl.set(track.dataUrl, assetPath);
      }
      return {
        ...track,
        dataUrl: null,
        assetPath,
      };
    });
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(PROJECT_JSON_FILE_NAME, JSON.stringify(archiveProject, null, 2));
  zip.file(manifest.thumbnailFile, await renderProjectThumbnail(projectData));
  return zip.generateAsync({ type: 'blob' });
};

const parseProjectFile = async (bytes: Uint8Array, fileName: string) => {
  if (fileName.toLowerCase().endsWith('.json')) {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as ProjectData;
  }

  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file('manifest.json');
  const manifest = manifestEntry
    ? (JSON.parse(await manifestEntry.async('string')) as ProjectArchiveManifest)
    : null;
  const projectEntry = zip.file(manifest?.projectFile ?? PROJECT_JSON_FILE_NAME);

  if (!projectEntry) {
    throw new Error('Project archive is missing project.json');
  }

  const archiveProject = JSON.parse(
    await projectEntry.async('string'),
  ) as ArchiveProjectData;

  const attachments = await Promise.all(
    archiveProject.attachments.map(async (attachment) => {
      if (!attachment.assetPath) {
        return {
          ...attachment,
          opacity: attachment.opacity ?? 1,
        } as Attachment;
      }

      const assetEntry = zip.file(attachment.assetPath);
      if (!assetEntry) {
        throw new Error(`Project archive is missing attachment asset: ${attachment.assetPath}`);
      }

      const data = await assetEntry.async('uint8array');
      const { assetPath, ...restAttachment } = attachment;
      const resolved = {
        ...restAttachment,
        opacity: restAttachment.opacity ?? 1,
        imageData: bytesToDataUrl(data, getMimeTypeFromAssetPath(assetPath)),
      } as Attachment;

      // Projects saved before mesh attachments were excluded from crop-archiving
      // (see serializeProjectArchive) have an asset that's already cropped to
      // opaqueBounds, while the mesh's vertex UVs are still baked against the
      // original, larger image — remap them into the cropped asset's UV space so
      // the mesh samples the right pixels instead of a shifted/wrong region.
      if (
        resolved.type === 'mesh' &&
        resolved.imageIsCropped &&
        resolved.opaqueBounds &&
        resolved.mesh?.vertices.length &&
        resolved.width > 0 &&
        resolved.height > 0
      ) {
        const { x: ox, y: oy, width: cw, height: ch } = resolved.opaqueBounds;
        resolved.mesh = {
          ...resolved.mesh,
          vertices: resolved.mesh.vertices.map((v) => ({
            ...v,
            u: (v.u * resolved.width - ox) / cw,
            v: (v.v * resolved.height - oy) / ch,
          })),
        };
        resolved.imageIsCropped = false;
      }

      return resolved;
    }),
  );

  const backgroundImage = archiveProject.backgroundAssetPath
    ? await (async () => {
        const assetEntry = zip.file(archiveProject.backgroundAssetPath!);
        if (!assetEntry) {
          throw new Error(`Project archive is missing background asset: ${archiveProject.backgroundAssetPath}`);
        }
        const data = await assetEntry.async('uint8array');
        return bytesToDataUrl(
          data,
          getMimeTypeFromAssetPath(archiveProject.backgroundAssetPath!),
        );
      })()
    : archiveProject.backgroundImage ?? null;

  const audioData = archiveProject.audioAssetPath
    ? await (async () => {
        const assetEntry = zip.file(archiveProject.audioAssetPath!);
        if (!assetEntry) {
          throw new Error(`Project archive is missing audio asset: ${archiveProject.audioAssetPath}`);
        }
        const data = await assetEntry.async('uint8array');
        return bytesToDataUrl(
          data,
          getMimeTypeFromAssetPath(archiveProject.audioAssetPath!),
        );
      })()
    : archiveProject.audioData ?? null;

  const audioTracks = await Promise.all(
    (archiveProject.audioTracks ?? []).map(async (track) => {
      if (!track.assetPath) {
        return {
          id: track.id,
          name: track.name,
          dataUrl: track.dataUrl ?? '',
          volume: track.volume,
          offsetFrames: track.offsetFrames,
        } as AudioTrack;
      }

      const assetEntry = zip.file(track.assetPath);
      if (!assetEntry) {
        throw new Error(`Project archive is missing audio asset: ${track.assetPath}`);
      }
      const data = await assetEntry.async('uint8array');
      const { assetPath, dataUrl, ...restTrack } = track;
      void assetPath;
      void dataUrl;
      return {
        ...restTrack,
        dataUrl: bytesToDataUrl(data, getMimeTypeFromAssetPath(track.assetPath)),
      } as AudioTrack;
    }),
  );

  const {
    attachments: archivedAttachments,
    audioTracks: archivedAudioTracks,
    backgroundAssetPath,
    audioAssetPath,
    ...projectRest
  } = archiveProject;
  void archivedAttachments;
  void archivedAudioTracks;
  void backgroundAssetPath;
  void audioAssetPath;

  return {
    ...projectRest,
    attachments,
    backgroundImage,
    audioData,
    audioTracks,
  };
};

export const buildProjectData = (): ProjectData => {
  const skeletonState = useSkeletonStore.getState();
  const animationState = useAnimationStore.getState();
  const slotState = useSlotStore.getState();
  const editorState = useEditorStore.getState();
  const deformerState = useDeformerStore.getState();
  const physicsState = usePhysicsStore.getState();

  // Normalize keyframes so the earliest frame across all bones becomes frame 0
  const originalKeyframes = animationState.keyframes;
  let minFrame = Infinity;
  for (const boneId of Object.keys(originalKeyframes)) {
    for (const frame of Object.keys(originalKeyframes[Number(boneId)])) {
      minFrame = Math.min(minFrame, Number(frame));
    }
  }
  const normalizedKeyframes: typeof originalKeyframes = {};
  if (minFrame !== Infinity && minFrame > 0) {
    for (const boneIdStr of Object.keys(originalKeyframes)) {
      const boneId = Number(boneIdStr);
      normalizedKeyframes[boneId] = {};
      for (const frameStr of Object.keys(originalKeyframes[boneId])) {
        const frame = Number(frameStr);
        normalizedKeyframes[boneId][frame - minFrame] = originalKeyframes[boneId][frame];
      }
    }
  } else {
    Object.assign(normalizedKeyframes, originalKeyframes);
  }

  const originalAttachmentOpacityKeyframes = animationState.attachmentOpacityKeyframes;
  const normalizedAttachmentOpacityKeyframes: typeof originalAttachmentOpacityKeyframes = {};
  if (minFrame !== Infinity && minFrame > 0) {
    for (const attachmentKey of Object.keys(originalAttachmentOpacityKeyframes)) {
      normalizedAttachmentOpacityKeyframes[attachmentKey] = {};
      for (const frameStr of Object.keys(originalAttachmentOpacityKeyframes[attachmentKey])) {
        const normalizedFrame = Number(frameStr) - minFrame;
        normalizedAttachmentOpacityKeyframes[attachmentKey][normalizedFrame] =
          originalAttachmentOpacityKeyframes[attachmentKey][Number(frameStr)];
      }
    }
  } else {
    Object.assign(normalizedAttachmentOpacityKeyframes, originalAttachmentOpacityKeyframes);
  }

  const originalSlotAttachmentKeyframes = animationState.slotAttachmentKeyframes;
  const normalizedSlotAttachmentKeyframes: typeof originalSlotAttachmentKeyframes = {};
  if (minFrame !== Infinity && minFrame > 0) {
    for (const slotId of Object.keys(originalSlotAttachmentKeyframes)) {
      normalizedSlotAttachmentKeyframes[Number(slotId)] = {};
      for (const frameStr of Object.keys(originalSlotAttachmentKeyframes[Number(slotId)])) {
        const normalizedFrame = Number(frameStr) - minFrame;
        normalizedSlotAttachmentKeyframes[Number(slotId)][normalizedFrame] =
          originalSlotAttachmentKeyframes[Number(slotId)][Number(frameStr)];
      }
    }
  } else {
    Object.assign(normalizedSlotAttachmentKeyframes, originalSlotAttachmentKeyframes);
  }

  const currentSetupPose = skeletonState.bones.reduce<SetupPose>((acc, bone) => {
    acc[bone.id] = {
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
      order: bone.order,
    };
    return acc;
  }, {});

  const setupPoseToSave: SetupPose =
    editorState.mode === 'setup'
      ? currentSetupPose
      : Object.keys(skeletonState.setupPose).length > 0
        ? skeletonState.setupPose
        : currentSetupPose;

  // Save bones using the setup pose so package preview and reload match the rig base pose.
  const savedBones = skeletonState.bones.map((bone) => {
    // Drop the transient world frame — it is recomputed on load from the pose.
    const rest = { ...bone };
    delete rest._wm;
    const pose = setupPoseToSave[bone.id];
    return pose ? { ...rest, ...pose } : rest;
  });

  return {
    version: '1.4',
    bones: savedBones,
    boneGroups: skeletonState.boneGroups
      .map((group) => ({
        ...group,
        boneIds: group.boneIds.filter((boneId) => savedBones.some((bone) => bone.id === boneId)),
      })),
    skins: skeletonState.skins,
    activeSkinId: skeletonState.activeSkinId,
    ikChainRootIds: skeletonState.ikChainRootIds.filter((rootId) =>
      savedBones.some((bone) => bone.id === rootId) &&
      savedBones.filter((bone) => bone.parentId === rootId).length === 1,
    ),
    setupPose: setupPoseToSave,
    slots: slotState.slots,
    attachments: slotState.attachments,
    keyframes: Object.fromEntries(
      Object.entries(normalizedKeyframes).map(([boneId, frames]) => [
        Number(boneId),
        Object.fromEntries(
          Object.entries(frames).map(([frame, keyframe]) => [
            Number(frame),
            {
              ...keyframe,
              order:
                keyframe.order ??
                skeletonState.bones.find((bone) => bone.id === Number(boneId))?.order ??
                0,
            },
          ]),
        ),
      ]),
    ),
    slotAttachmentKeyframes: normalizedSlotAttachmentKeyframes,
    attachmentOpacityKeyframes: normalizedAttachmentOpacityKeyframes,
    meshDeformKeyframes: animationState.meshDeformKeyframes,
    deformers: deformerState.deformers,
    deformerKeyframes: deformerState.deformerKeyframes,
    nextDeformerId: deformerState.nextDeformerId,
    physicsConfigs: physicsState.configs,
    duration: animationState.duration,
    fps: animationState.fps,
    backgroundImage: editorState.backgroundImage,
    audioTracks: animationState.audioTracks,
    activeAudioTrackId: animationState.activeAudioTrackId,
    audioData: animationState.audioData,
    audioName: animationState.audioName,
    audioVolume: animationState.audioVolume,
    audioOffsetFrames: animationState.audioOffsetFrames,
  };
};

export const applyProjectData = (
  projectData: Partial<ProjectData>,
  sourcePath: string | null,
) => {
  const bones = (projectData.bones ?? []).map((bone, index) => ({
    ...bone,
    order: Math.round(bone.order ?? index),
  }));
  const skins = projectData.skins ?? [{ id: 0, name: 'default', color: '#7c3aed' }];
  const slots = projectData.slots ?? [];
  const setupPose = Object.fromEntries(
    Object.entries(projectData.setupPose ?? {}).map(([boneId, pose]) => [
      Number(boneId),
      {
        ...pose,
        order: pose.order ?? bones.find((bone) => bone.id === Number(boneId))?.order ?? 0,
      },
    ]),
  );

  useSkeletonStore.setState({
    bones,
    boneGroups: projectData.boneGroups ?? [],
    skins,
    activeSkinId: projectData.activeSkinId ?? skins[0]?.id ?? 0,
    ikChainRootIds: projectData.ikChainRootIds ?? [],
    setupPose,
    boneIdCounter: Math.max(...bones.map((bone) => bone.id), 0) + 1,
    boneGroupIdCounter: Math.max(...(projectData.boneGroups ?? []).map((group) => group.id), 0) + 1,
    skinIdCounter: Math.max(...skins.map((skin) => skin.id), 0) + 1,
  });

  useSlotStore.setState({
    slots,
    attachments: (projectData.attachments ?? []).map((attachment) => {
      // Migrate old-format mesh fields into the new `mesh` field; both use the same
      // attachment-local coordinate space (origin at the image centre) and UV range,
      // so the geometry carries over as-is and existing deform keyframes keep working.
      const next = {
        ...attachment,
        opacity: attachment.opacity ?? 1,
      } as Attachment & Record<string, unknown>;
      const legacyVertices = next.meshVertices as MeshVertex[] | undefined;
      const legacyTriangles = next.meshTriangles as MeshTriangle[] | undefined;
      const legacyGrid = next.meshGrid as { columns: number; rows: number } | undefined;
      const legacyPinned = next.meshPinnedVertices as boolean[] | undefined;
      const legacyWeights = next.meshVertexWeights as MeshVertexWeight[][] | undefined;
      delete next.meshVertices;
      delete next.meshTriangles;
      delete next.meshGrid;
      delete next.meshPinnedVertices;
      delete next.meshVertexWeights;

      const migrated = next as Attachment;
      if (!migrated.mesh?.vertices.length && legacyVertices?.length && legacyTriangles?.length) {
        migrated.type = 'mesh';
        migrated.mesh = {
          vertices: legacyVertices,
          triangles: legacyTriangles,
          edges: buildMeshEdges(legacyTriangles),
          ...(legacyGrid ? { grid: legacyGrid } : {}),
        };
        if (legacyPinned?.length) migrated.pinned = legacyPinned;
        if (legacyWeights?.length) migrated.vertexWeights = legacyWeights;
      }

      // Degrade mesh attachments that carry no usable geometry to plain images.
      if (migrated.type === 'mesh' && !migrated.mesh?.vertices.length) {
        migrated.type = 'image';
        delete (next as Record<string, unknown>).mesh;
      }
      return migrated;
    }),
    nextSlotId: Math.max(...slots.map((slot) => slot.id), 0) + 1,
  });

  const audioTracks =
    projectData.audioTracks?.length
      ? projectData.audioTracks
      : projectData.audioData
        ? [
            {
              id: 1,
              name: projectData.audioName ?? 'Audio track',
              dataUrl: projectData.audioData,
              volume: projectData.audioVolume ?? 0.8,
              offsetFrames: projectData.audioOffsetFrames ?? 0,
            },
          ]
        : [];
  const activeAudioTrack =
    audioTracks.find((track) => track.id === projectData.activeAudioTrackId) ??
    audioTracks[0] ??
    null;

  useAnimationStore.setState({
    keyframes: Object.fromEntries(
      Object.entries(projectData.keyframes ?? {}).map(([boneId, frames]) => [
        Number(boneId),
        Object.fromEntries(
          Object.entries(frames).map(([frame, keyframe]) => [
            Number(frame),
            {
              ...keyframe,
              order: keyframe.order ?? bones.find((bone) => bone.id === Number(boneId))?.order ?? 0,
            },
          ]),
        ),
      ]),
    ),
    slotAttachmentKeyframes: projectData.slotAttachmentKeyframes ?? {},
    attachmentOpacityKeyframes: projectData.attachmentOpacityKeyframes ?? {},
    meshDeformKeyframes: projectData.meshDeformKeyframes ?? {},
    duration: projectData.duration ?? 60,
    fps: projectData.fps ?? 24,
    frame: 0,
    playing: false,
    audioTracks,
    activeAudioTrackId: activeAudioTrack?.id ?? null,
    nextAudioTrackId:
      Math.max(
        0,
        ...audioTracks.map((track) => track.id),
        projectData.audioData ? 1 : 0,
      ) + 1,
    audioData: activeAudioTrack?.dataUrl ?? null,
    audioName: activeAudioTrack?.name ?? null,
    audioVolume: activeAudioTrack?.volume ?? 0.8,
    audioOffsetFrames: activeAudioTrack?.offsetFrames ?? 0,
  });

  useDeformerStore.getState().replaceAll(
    projectData.deformers ?? [],
    projectData.nextDeformerId ?? 1,
    projectData.deformerKeyframes ?? {},
  );
  usePhysicsStore.getState().replaceAll(projectData.physicsConfigs ?? []);

  useEditorStore.setState({
    backgroundImage: projectData.backgroundImage ?? null,
    currentProjectPath: sourcePath,
    selectedBoneId: null,
    selectedBoneIds: [],
    selectedSlotId: null,
  });

  if (!projectData.setupPose || Object.keys(projectData.setupPose).length === 0) {
    useSkeletonStore.getState().saveSetupPose();
  }

  // Restore bones to setup pose so they display correctly at frame 0
  useSkeletonStore.getState().restoreSetupPose();

  useHistoryStore.getState().clearHistory();
};

export const createNewProject = () => {
  useSkeletonStore.setState({
    bones: [],
    boneGroups: [],
    skins: [{ id: 0, name: 'default', color: '#7c3aed' }],
    activeSkinId: 0,
    ikChainRootIds: [],
    setupPose: {},
    boneIdCounter: 0,
    boneGroupIdCounter: 0,
    skinIdCounter: 1,
  });

  useSlotStore.setState({
    slots: [],
    attachments: [],
    nextSlotId: 1,
  });

  useAnimationStore.setState({
    keyframes: {},
    slotAttachmentKeyframes: {},
    attachmentOpacityKeyframes: {},
    frame: 0,
    duration: 60,
    fps: 24,
    playing: false,
    audioTracks: [],
    activeAudioTrackId: null,
    nextAudioTrackId: 1,
    audioData: null,
    audioName: null,
    audioVolume: 0.8,
    audioOffsetFrames: 0,
  });

  useEditorStore.setState((state) => ({
    tool: 'pose',
    mode: 'setup',
    selectedBoneId: null,
    selectedBoneIds: [],
    selectedSlotId: null,
    showBoneIndicators: state.showBoneIndicators,
    onionSkinEnabled: state.onionSkinEnabled,
    attachmentDragEnabled: false,
    backgroundImage: null,
    currentProjectPath: null,
  }));

  useCameraStore.setState((state) => ({
    x: 0,
    y: 0,
    zoom: 1,
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
  }));

  useHistoryStore.getState().clearHistory();
};

export const getSuggestedProjectFileName = () => {
  const currentProjectPath = useEditorStore.getState().currentProjectPath;
  if (!currentProjectPath) return `spinebones-project.${PROJECT_ARCHIVE_EXTENSION}`;

  return `${stripExtension(getFileNameFromPath(currentProjectPath))}.${PROJECT_ARCHIVE_EXTENSION}`;
};

export const saveProject = async (forceDialog = false) => {
  const projectData = buildProjectData();
  const currentProjectPath = useEditorStore.getState().currentProjectPath;
  const shouldPromptForPackagePath =
    forceDialog || !currentProjectPath || isJsonProjectPath(currentProjectPath);
  const targetPath = await saveBlobFile(
    getSuggestedProjectFileName(),
    await serializeProjectArchive(projectData),
    PROJECT_FILTERS,
    shouldPromptForPackagePath ? null : currentProjectPath,
    shouldPromptForPackagePath,
  );

  if (targetPath) {
    useEditorStore.getState().setCurrentProjectPath(targetPath);
    rememberRecentProject(await createCachedProjectPreview(projectData, targetPath));
    useHistoryStore.getState().markClean();
  }

  return targetPath;
};

export const loadProjectFromPath = async (path: string) => {
  const bytes = await readBinaryFileAtPath(path);
  const preview = await readProjectPreview(bytes, getFileNameFromPath(path), path);
  applyProjectData(
    await parseProjectFile(bytes, getFileNameFromPath(path)),
    path,
  );
  rememberRecentProject(preview);
  return path;
};

export const loadProjectFromRecentPath = async (path: string) => {
  try {
    return await loadProjectFromPath(path);
  } catch (directReadError) {
    const loadedProject = await openBinaryFile(PROJECT_ACCEPT, {
      defaultPath: path,
    });

    if (!loadedProject) {
      throw directReadError;
    }

    if (loadedProject.path) {
      return loadProjectFromPath(loadedProject.path);
    }

    applyProjectData(
      await parseProjectFile(loadedProject.bytes, loadedProject.name),
      null,
    );
    return null;
  }
};

export const loadProject = async () => {
  const loadedProject = await openBinaryFile(PROJECT_ACCEPT);

  if (!loadedProject) return null;

  if (!isSbnProjectPath(loadedProject.path ?? loadedProject.name)) {
    alert('Please choose a SpineBones project file with the .sbn extension.');
    return null;
  }

  if (loadedProject.path) {
    await loadProjectFromPath(loadedProject.path);
    return loadedProject.path;
  }

  applyProjectData(
    await parseProjectFile(loadedProject.bytes, loadedProject.name),
    null,
  );
  return null;
};

export const readProjectPreviewFromPath = async (path: string) =>
  readProjectPreview(await readBinaryFileAtPath(path), getFileNameFromPath(path), path);
