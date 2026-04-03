import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAnimationStore } from './stores/animationStore';
import { useEditorStore } from './stores/editorStore';
import { useSkeletonStore } from './stores/skeletonStore';
import { useSlotStore } from './stores/slotStore';
import { ensureDesktopMenu } from './utils/desktopMenu';
import { applyAnimationPromptToEditor, applyIdlePromptToEditor } from './utils/aiMcpRuntime';
import {
  getFileNameFromPath,
  getLaunchProjectPath,
  getMcpBridgeInfo,
  isDesktopApp,
  updateMcpEditorState,
} from './utils/nativeIO';
import { createNewProject, loadProject, loadProjectFromPath, saveProject } from './utils/projectPersistence';

type McpEditorCommand = {
  commandType: string;
  prompt?: string;
};

const buildMcpSnapshot = () => {
  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  const editor = useEditorStore.getState();
  const slotState = useSlotStore.getState();

  return {
    ready: true,
    projectPath: editor.currentProjectPath,
    mode: editor.mode,
    tool: editor.tool,
    selectedBoneId: editor.selectedBoneId,
    bones: skeleton.bones.map((bone) => ({
      id: bone.id,
      name: bone.name,
      parentId: bone.parentId,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
    })),
    boneCount: skeleton.bones.length,
    slotCount: slotState.slots.length,
    attachmentCount: slotState.attachments.length,
    keyframeBoneCount: Object.keys(animation.keyframes).length,
    slots: slotState.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      boneId: slot.boneId,
      drawOrder: slot.drawOrder,
      attachmentName: slot.attachmentName,
    })),
    attachments: slotState.attachments.map((attachment) => ({
      name: attachment.name,
      slotId: attachment.slotId,
      type: attachment.type,
      width: attachment.width,
      height: attachment.height,
      x: attachment.x,
      y: attachment.y,
      rotation: attachment.rotation,
      scaleX: attachment.scaleX,
      scaleY: attachment.scaleY,
    })),
    frame: animation.frame,
    duration: animation.duration,
    fps: animation.fps,
    playing: animation.playing,
    keyframes: animation.keyframes,
    currentPromptCapability: [
      'apply_animation_prompt',
      'apply_idle_prompt',
    ],
  };
};

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
    if (!isDesktopApp()) return;

    let timeoutId: number | null = null;

    const pushSnapshot = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void updateMcpEditorState(buildMcpSnapshot()).catch((error) => {
          console.error('Failed to sync MCP editor state:', error);
        });
      }, 120);
    };

    pushSnapshot();

    const unsubscribeSkeleton = useSkeletonStore.subscribe(pushSnapshot);
    const unsubscribeAnimation = useAnimationStore.subscribe(pushSnapshot);
    const unsubscribeEditor = useEditorStore.subscribe(pushSnapshot);
    const unsubscribeSlots = useSlotStore.subscribe(pushSnapshot);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      unsubscribeSkeleton();
      unsubscribeAnimation();
      unsubscribeEditor();
      unsubscribeSlots();
    };
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let unlisten: (() => void) | null = null;

    void getMcpBridgeInfo().then((info) => {
      if (info) {
        console.info(`SpineBones MCP bridge ready at ${info.url}`);
      }
    });

    void listen<McpEditorCommand>('spine:mcp-command', async (event) => {
      const payload = event.payload;
      if (payload.commandType === 'apply_animation_prompt') {
        const result = applyAnimationPromptToEditor(
          payload.prompt?.trim() || 'create a light idle animation',
        );
        console.info('MCP apply_animation_prompt:', result.summary);
        return;
      }

      if (payload.commandType === 'apply_idle_prompt') {
        const result = applyIdlePromptToEditor(
          payload.prompt?.trim() || 'buat idle napas pelan dan rambut sedikit sway',
        );
        console.info('MCP apply_idle_prompt:', result.summary);
        return;
      }

      console.warn('Unknown MCP command received:', payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    document.title = currentProjectPath
      ? `${getFileNameFromPath(currentProjectPath)} - SpineBones`
      : 'SpineBones';
  }, [currentProjectPath]);

  return <EditorLayout />;
}

export default App;
