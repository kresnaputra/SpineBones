import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { isDesktopApp } from './nativeIO';

type DesktopMenuHandlers = {
  onNewProject: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onSaveAs: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onOpenProjectBrowser: () => void | Promise<void>;
  onExportVideo: () => void | Promise<void>;
  onExportSpriteSheet: () => void | Promise<void>;
  onExportPngSequence: () => void | Promise<void>;
  onToggleBoneIndicators: () => void | Promise<void>;
  onOpenHelp: () => void | Promise<void>;
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
          id: 'file-new-project',
          text: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          action: () => void handlers.onNewProject(),
        },
        await buildPredefined('Separator'),
        {
          id: 'file-save',
          text: 'Save Project Package',
          accelerator: 'CmdOrCtrl+S',
          action: () => void handlers.onSave(),
        },
        {
          id: 'file-save-as',
          text: 'Export Project Package As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          action: () => void handlers.onSaveAs(),
        },
        {
          id: 'file-open',
          text: 'Import/Open Project…',
          accelerator: 'CmdOrCtrl+O',
          action: () => void handlers.onOpen(),
        },
        {
          id: 'file-open-project-browser',
          text: 'Project Browser',
          accelerator: 'CmdOrCtrl+Shift+O',
          action: () => void handlers.onOpenProjectBrowser(),
        },
        await buildPredefined('Separator'),
        {
          id: 'file-export-video',
          text: 'Export Video',
          action: () => void handlers.onExportVideo(),
        },
        {
          id: 'file-export-spritesheet',
          text: 'Export Sprite Sheet',
          action: () => void handlers.onExportSpriteSheet(),
        },
        {
          id: 'file-export-png-sequence',
          text: 'Export PNG Sequence',
          action: () => void handlers.onExportPngSequence(),
        },
        await buildPredefined('Separator'),
        await buildPredefined('Quit'),
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
      ],
    });

    const helpMenu = await Submenu.new({
      text: 'Help',
      items: [
        await MenuItem.new({
          id: 'help-user-guide',
          text: 'SpineBones Guide',
          accelerator: 'CmdOrCtrl+/',
          action: () => void handlers.onOpenHelp(),
        }),
      ],
    });

    const appMenu = await Menu.new({
      items: [fileMenu, editMenu, viewMenu, windowMenu, helpMenu],
    });

    await appMenu.setAsAppMenu();
  })();

  return menuSetupPromise;
};
