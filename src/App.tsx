import { useEffect } from 'react';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditorStore } from './stores/editorStore';
import { ensureDesktopMenu } from './utils/desktopMenu';
import { getFileNameFromPath } from './utils/nativeIO';
import { createNewProject, loadProject, saveProject } from './utils/projectPersistence';

function App() {
  useKeyboardShortcuts();
  const { currentProjectPath, setShowHelpDialog } = useEditorStore();

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
  }, [setShowHelpDialog]);

  useEffect(() => {
    document.title = currentProjectPath
      ? `${getFileNameFromPath(currentProjectPath)} - SpineBones`
      : 'SpineBones';
  }, [currentProjectPath]);

  return <EditorLayout />;
}

export default App;
