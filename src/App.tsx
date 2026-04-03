import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditorStore } from './stores/editorStore';
import { ensureDesktopMenu } from './utils/desktopMenu';
import { getFileNameFromPath, getLaunchProjectPath, isDesktopApp } from './utils/nativeIO';
import { createNewProject, loadProject, loadProjectFromPath, saveProject } from './utils/projectPersistence';

function App() {
  useKeyboardShortcuts();
  const { currentProjectPath, setShowHelpDialog, setShowProjectBrowser } = useEditorStore();
  const didOpenProjectBrowserRef = useRef(false);

  useEffect(() => {
    void ensureDesktopMenu({
      onNewProject: () => {
        createNewProject();
      },
      onSave: async () => {
        void (await saveProject());
      },
      onSaveAs: async () => {
        void (await saveProject(true));
      },
      onOpen: async () => {
        void (await loadProject());
      },
      onOpenProjectBrowser: () => {
        setShowProjectBrowser(true);
      },
      onExportVideo: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-video'));
      },
      onExportSpriteSheet: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-spritesheet'));
      },
      onExportPngSequence: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-png-sequence'));
      },
      onToggleBoneIndicators: () => {
        const editor = useEditorStore.getState();
        editor.setShowBoneIndicators(!editor.showBoneIndicators);
      },
      onOpenHelp: () => {
        setShowHelpDialog(true);
      },
    });
  }, [setShowHelpDialog, setShowProjectBrowser]);

  useEffect(() => {
    if (!isDesktopApp() || didOpenProjectBrowserRef.current) return;
    didOpenProjectBrowserRef.current = true;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let launchEventHandled = false;

    const handleLaunchPath = async (path: string) => {
      launchEventHandled = true;
      try {
        await loadProjectFromPath(path);
        setShowProjectBrowser(false);
      } catch (error) {
        console.error('Failed to open launch project:', error);
      }
    };

    void listen<string>('spine:launch-project-path', async (event) => {
      await handleLaunchPath(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    const initLaunchProject = async () => {
      const launchPath = await getLaunchProjectPath();
      if (cancelled) return;

      if (launchPath) {
        await handleLaunchPath(launchPath);
        return;
      }

      window.setTimeout(() => {
        if (cancelled || launchEventHandled) return;
        if (!useEditorStore.getState().currentProjectPath) {
          setShowProjectBrowser(true);
        }
      }, 700);
    };

    void initLaunchProject();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [setShowProjectBrowser]);

  useEffect(() => {
    document.title = currentProjectPath
      ? `${getFileNameFromPath(currentProjectPath)} - SpineBones`
      : 'SpineBones';
  }, [currentProjectPath]);

  return <EditorLayout />;
}

export default App;
