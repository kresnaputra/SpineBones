import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function App() {
  useKeyboardShortcuts();

  return <EditorLayout />;
}

export default App;
