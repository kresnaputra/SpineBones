import { useEffect } from 'react';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSkeletonStore } from './stores/skeletonStore';
import { createDemoSkeleton } from './utils/demoSkeleton';

function App() {
  useKeyboardShortcuts();

  useEffect(() => {
    if (useSkeletonStore.getState().bones.length > 0) return;
    createDemoSkeleton();
  }, []);

  return <EditorLayout />;
}

export default App;
