import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';

type FileFilter = {
  name: string;
  extensions: string[];
};

type OpenDialogOptions = {
  filters?: FileFilter[];
  defaultPath?: string;
};

export interface LoadedFile {
  name: string;
  path: string | null;
  text: string;
}

export interface LoadedImageFile {
  name: string;
  path: string | null;
  dataUrl: string;
}

export interface LoadedAudioFile {
  name: string;
  path: string | null;
  dataUrl: string;
}

export interface LoadedBinaryFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

export interface SpritePartPrediction {
  classIndex: number;
  label: string;
  confidence: number;
}

export interface McpBridgeInfo {
  port: number;
  url: string;
  externalClientActive: boolean;
  lastClientPath: string | null;
  lastClientSeenSecondsAgo: number | null;
}

export interface McpServerStatus {
  running: boolean;
  pid: number | null;
  command: string;
  serverPath: string;
  serverSource: string;
  serverUrl: string;
  lastError: string | null;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
};

export const isDesktopApp = () => isTauri();

export const getLaunchProjectPath = async (): Promise<string | null> => {
  if (!isDesktopApp()) return null;
  return invoke<string | null>('get_launch_project_path');
};

export const getMcpBridgeInfo = async (): Promise<McpBridgeInfo | null> => {
  if (!isDesktopApp()) return null;
  return invoke<McpBridgeInfo>('get_mcp_bridge_info');
};

export const updateMcpEditorState = async (snapshot: unknown) => {
  if (!isDesktopApp()) return;
  await invoke('update_mcp_editor_state', {
    snapshotJson: JSON.stringify(snapshot),
  });
};

export const getMcpServerStatus = async (): Promise<McpServerStatus | null> => {
  if (!isDesktopApp()) return null;
  return invoke<McpServerStatus>('get_mcp_server_status');
};

export const startMcpServer = async (): Promise<McpServerStatus | null> => {
  if (!isDesktopApp()) return null;
  return invoke<McpServerStatus>('start_mcp_server');
};

export const stopMcpServer = async () => {
  if (!isDesktopApp()) return;
  await invoke('stop_mcp_server');
};

export const classifySpritePart = async (path: string): Promise<SpritePartPrediction | null> => {
  if (!isDesktopApp()) return null;
  return invoke<SpritePartPrediction>('classify_sprite_part', { path });
};

export const classifySpritePartBytes = async (
  bytes: Uint8Array,
): Promise<SpritePartPrediction | null> => {
  if (!isDesktopApp()) return null;
  return invoke<SpritePartPrediction>('classify_sprite_part_bytes', {
    bytes: Array.from(bytes),
  });
};

export const getFileNameFromPath = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

export const stripExtension = (fileName: string) =>
  fileName.replace(/\.[^/.]+$/, '');

const blobToDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });

const pickBrowserFile = async (
  accept: string,
  mode: 'text' | 'data-url',
): Promise<LoadedFile | LoadedImageFile | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      if (mode === 'text') {
        file
          .text()
          .then((text) => {
            resolve({
              name: file.name,
              path: null,
              text,
            });
          })
          .catch((error) => {
            console.error(error);
            resolve(null);
          });
        return;
      }

      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          name: file.name,
          path: null,
          dataUrl: reader.result as string,
        });
      reader.onerror = () => {
        console.error(reader.error);
        resolve(null);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  });

const getMimeTypeFromPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_TYPES[extension] ?? AUDIO_MIME_TYPES[extension] ?? 'application/octet-stream';
};

const normalizeDialogSelection = (selection: string | string[] | null) => {
  if (Array.isArray(selection)) {
    return selection[0] ?? null;
  }

  return selection;
};

export const openTextFile = async (
  accept: string,
  options?: OpenDialogOptions,
): Promise<LoadedFile | null> => {
  if (!isDesktopApp()) {
    return (await pickBrowserFile(accept, 'text')) as LoadedFile | null;
  }

  const selectedPath = normalizeDialogSelection(
    await openDialog({
      multiple: false,
      directory: false,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
    }),
  );

  if (!selectedPath) return null;

  return {
    name: getFileNameFromPath(selectedPath),
    path: selectedPath,
    text: await readTextFile(selectedPath),
  };
};

export const openBinaryFile = async (
  accept: string,
  options?: OpenDialogOptions,
): Promise<LoadedBinaryFile | null> => {
  if (!isDesktopApp()) {
    const loadedFile = await pickBrowserFile(accept, 'data-url');
    if (!loadedFile || !('dataUrl' in loadedFile)) return null;

    const response = await fetch(loadedFile.dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    return {
      name: loadedFile.name,
      path: loadedFile.path,
      bytes: new Uint8Array(arrayBuffer),
    };
  }

  const selectedPath = normalizeDialogSelection(
    await openDialog({
      multiple: false,
      directory: false,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
    }),
  );

  if (!selectedPath) return null;

  return {
    name: getFileNameFromPath(selectedPath),
    path: selectedPath,
    bytes: await readFile(selectedPath),
  };
};

export const readBinaryFileAtPath = async (path: string): Promise<Uint8Array> => {
  if (!isDesktopApp()) {
    throw new Error('Reading arbitrary local paths is only supported in the desktop app');
  }

  try {
    return await readFile(path);
  } catch (error) {
    console.warn('Falling back to native project file read:', error);
    const bytes = await invoke<number[]>('read_project_file', { path });
    return Uint8Array.from(bytes);
  }
};

export const loadImageFileFromPath = async (path: string): Promise<LoadedImageFile> => {
  const bytes = await readBinaryFileAtPath(path);
  const blob = new Blob([bytes.slice().buffer], { type: getMimeTypeFromPath(path) });
  return {
    name: getFileNameFromPath(path),
    path,
    dataUrl: await blobToDataUrl(blob),
  };
};

export const loadAudioFileFromPath = async (path: string): Promise<LoadedAudioFile> => {
  const bytes = await readBinaryFileAtPath(path);
  const blob = new Blob([bytes.slice().buffer], { type: getMimeTypeFromPath(path) });
  return {
    name: getFileNameFromPath(path),
    path,
    dataUrl: await blobToDataUrl(blob),
  };
};

export const openImageFile = async (
  options?: OpenDialogOptions,
): Promise<LoadedImageFile | null> => {
  if (!isDesktopApp()) {
    return (await pickBrowserFile('image/*', 'data-url')) as LoadedImageFile | null;
  }

  const selectedPath = normalizeDialogSelection(
    await openDialog({
      multiple: false,
      directory: false,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
    }),
  );

  if (!selectedPath) return null;

  const bytes = await readFile(selectedPath);
  const blob = new Blob([bytes], { type: getMimeTypeFromPath(selectedPath) });

  return {
    name: getFileNameFromPath(selectedPath),
    path: selectedPath,
    dataUrl: await blobToDataUrl(blob),
  };
};

export const openAudioFile = async (
  options?: OpenDialogOptions,
): Promise<LoadedAudioFile | null> => {
  if (!isDesktopApp()) {
    return (await pickBrowserFile('audio/*', 'data-url')) as LoadedAudioFile | null;
  }

  const selectedPath = normalizeDialogSelection(
    await openDialog({
      multiple: false,
      directory: false,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
    }),
  );

  if (!selectedPath) return null;

  const bytes = await readFile(selectedPath);
  const blob = new Blob([bytes], { type: getMimeTypeFromPath(selectedPath) });

  return {
    name: getFileNameFromPath(selectedPath),
    path: selectedPath,
    dataUrl: await blobToDataUrl(blob),
  };
};

const triggerDownload = (fileName: string, href: string) => {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
};

export const saveTextFile = async (
  defaultPath: string,
  contents: string,
  filters: FileFilter[],
  currentPath?: string | null,
  forceDialog = false,
): Promise<string | null> => {
  if (!isDesktopApp()) {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    triggerDownload(defaultPath, url);
    URL.revokeObjectURL(url);
    return null;
  }

  const targetPath =
    !forceDialog && currentPath
      ? currentPath
      : await saveDialog({
          defaultPath: currentPath ?? defaultPath,
          filters,
        });

  if (!targetPath) return null;

  await writeTextFile(targetPath, contents);
  return targetPath;
};

export const saveBlobFile = async (
  defaultPath: string,
  blob: Blob,
  filters: FileFilter[],
  currentPath?: string | null,
  forceDialog = false,
): Promise<string | null> => {
  if (!isDesktopApp()) {
    const url = URL.createObjectURL(blob);
    triggerDownload(defaultPath, url);
    URL.revokeObjectURL(url);
    return null;
  }

  const targetPath =
    !forceDialog && currentPath
      ? currentPath
      : await saveDialog({
          defaultPath: currentPath ?? defaultPath,
          filters,
        });

  if (!targetPath) return null;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    await writeFile(targetPath, bytes);
  } catch (error) {
    console.warn('Falling back to native project file write:', error);
    await invoke('write_project_file', { path: targetPath, bytes: Array.from(bytes) });
  }
  return targetPath;
};

export const saveBlobToPath = async (path: string, blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    await writeFile(path, bytes);
  } catch (error) {
    console.warn('Falling back to native project file write:', error);
    await invoke('write_project_file', { path, bytes: Array.from(bytes) });
  }
  return path;
};

export const openPathWithDefaultApp = async (path: string) => {
  if (!isDesktopApp()) return;
  await openPath(path);
};
