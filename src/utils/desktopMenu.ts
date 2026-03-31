import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { isDesktopApp } from './nativeIO';

type DesktopMenuHandlers = {
  onSave: () => void | Promise<void>;
  onSaveAs: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onExportSpine: () => void | Promise<void>;
  onExportVideo: () => void | Promise<void>;
  onToggleBoneIndicators: () => void | Promise<void>;
};

let menuSetupPromise: Promise<void> | null = null;

type PredefinedItem = NonNullable<Parameters<typeof PredefinedMenuItem.new>[0]>['item'];

const buildPredefined = (item: PredefinedItem) =>
  PredefinedMenuItem.new({ item });

export const ensureDesktopMenu = async (handlers: DesktopMenuHandlers) => {
  if (!isDesktopApp()) return;
  if (menuSetupPromise) return menuSetupPromise;

  menuSetupPromise = (async () => {
    const fileMenu = await Submenu.new({
      text: 'File',
      items: [
        {
          id: 'file-save',
          text: 'Save',
          accelerator: 'CmdOrCtrl+S',
          action: () => void handlers.onSave(),
        },
        {
          id: 'file-save-as',
          text: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          action: () => void handlers.onSaveAs(),
        },
        {
          id: 'file-open',
          text: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          action: () => void handlers.onOpen(),
        },
        await buildPredefined('Separator'),
        {
          id: 'file-export-spine',
          text: 'Export Spine',
          action: () => void handlers.onExportSpine(),
        },
        {
          id: 'file-export-video',
          text: 'Export Video',
          action: () => void handlers.onExportVideo(),
        },
        await buildPredefined('Separator'),
        await buildPredefined('CloseWindow'),
      ],
    });

    const editMenu = await Submenu.new({
      text: 'Edit',
      items: [
        await buildPredefined('Undo'),
        await buildPredefined('Redo'),
        await buildPredefined('Separator'),
        await buildPredefined('Cut'),
        await buildPredefined('Copy'),
        await buildPredefined('Paste'),
        await buildPredefined('SelectAll'),
      ],
    });

    const viewMenu = await Submenu.new({
      text: 'View',
      items: [
        await MenuItem.new({
          id: 'view-reload',
          text: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          action: () => window.location.reload(),
        }),
        await MenuItem.new({
          id: 'view-toggle-bone-indicators',
          text: 'Toggle Bone Indicators',
          accelerator: 'CmdOrCtrl+B',
          action: () => void handlers.onToggleBoneIndicators(),
        }),
        await buildPredefined('Fullscreen'),
      ],
    });

    const windowMenu = await Submenu.new({
      text: 'Window',
      items: [
        await buildPredefined('Minimize'),
        await buildPredefined('Maximize'),
        await buildPredefined('Separator'),
        await buildPredefined('CloseWindow'),
      ],
    });

    const appMenu = await Menu.new({
      items: [fileMenu, editMenu, viewMenu, windowMenu],
    });

    await appMenu.setAsAppMenu();
  })();

  return menuSetupPromise;
};
