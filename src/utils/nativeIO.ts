import { isTauri } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';

type FileFilter = {
  name: string;
  extensions: string[];
};

type OpenDialogOptions = {
  filters?: FileFilter[];
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
    }),
  );

  if (!selectedPath) return null;

  return {
    name: getFileNameFromPath(selectedPath),
    path: selectedPath,
    text: await readTextFile(selectedPath),
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
): Promise<string | null> => {
  if (!isDesktopApp()) {
    const url = URL.createObjectURL(blob);
    triggerDownload(defaultPath, url);
    URL.revokeObjectURL(url);
    return null;
  }

  const targetPath = await saveDialog({
    defaultPath,
    filters,
  });

  if (!targetPath) return null;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(targetPath, bytes);
  return targetPath;
};

export const openPathWithDefaultApp = async (path: string) => {
  if (!isDesktopApp()) return;
  await openPath(path);
};
