import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Trash2, X, Package, FileJson, FilePlus2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import {
  clearRecentProjects,
  getRecentProjects,
  removeRecentProject,
  type RecentProjectRecord,
} from '../../utils/recentProjects';
import {
  createNewProject,
  loadProject,
  loadProjectFromRecentPath,
} from '../../utils/projectPersistence';
import { isDesktopApp } from '../../utils/nativeIO';

export const ProjectBrowserDialog = () => {
  const { showProjectBrowser, setShowProjectBrowser } = useEditorStore();
  const [items, setItems] = useState<RecentProjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!showProjectBrowser || !isDesktopApp()) return;

    let cancelled = false;

    const loadRecent = () => {
      setLoading(true);
      if (cancelled) return;
      setItems(getRecentProjects());
      setLoading(false);
    };

    loadRecent();

    return () => {
      cancelled = true;
    };
  }, [showProjectBrowser, refreshKey]);

  if (!showProjectBrowser || !isDesktopApp()) return null;

  const handleOpenRecent = async (path: string) => {
    try {
      await loadProjectFromRecentPath(path);
      setShowProjectBrowser(false);
    } catch (error) {
      console.error('Failed to open recent project:', error);
      alert(
        error instanceof Error
          ? `Failed to open project: ${error.message}`
          : 'Failed to open project',
      );
    }
  };

  const handleImportProject = async () => {
    try {
      await loadProject();
      setShowProjectBrowser(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to import project');
    }
  };

  const handleNewProject = () => {
    createNewProject();
    setShowProjectBrowser(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-8 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 panel-padding-bottom panel-padding-top">
          <div>
            <h2 className="text-lg font-semibold text-text panel-padding-left">Project Browser</h2>
            <p className="mt-1 text-xs text-text-dim panel-padding-left">
              Browse recent `.sbn` packages and legacy `.json` projects.
            </p>
          </div>

          <button
            onClick={() => setShowProjectBrowser(false)}
            className="rounded-lg border border-transparent p-2 text-text-dim transition hover:border-border hover:bg-panel2 hover:text-text panel-padding-right"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-5 py-3 panel-padding-left panel-padding-right panel-padding-top panel-padding-bottom">
          <button
            onClick={handleNewProject}
            className="flex items-center gap-2 rounded-lg border border-transparent bg-panel2 px-3 py-2 text-xs text-text transition hover:border-border hover:text-white"
          >
            <FilePlus2 size={14} />
            New Project
          </button>

          <button
            onClick={() => void handleImportProject()}
            className="flex items-center gap-2 rounded-lg border border-transparent bg-panel2 px-3 py-2 text-xs text-text transition hover:border-border hover:text-white"
          >
            <FolderOpen size={14} />
            Import / Open File
          </button>

          <button
            onClick={() => setRefreshKey((value) => value + 1)}
            className="flex items-center gap-2 rounded-lg border border-transparent bg-panel2 px-3 py-2 text-xs text-text transition hover:border-border hover:text-white"
          >
            <RefreshCw size={14} />
            Refresh
          </button>

          <button
            onClick={() => {
              clearRecentProjects();
              setItems([]);
            }}
            className="ml-auto flex items-center gap-2 rounded-lg border border-transparent bg-panel2 px-3 py-2 text-xs text-text transition hover:border-border hover:text-white"
          >
            <Trash2 size={14} />
            Clear Recent
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {loading ? (
            <div className="col-span-full rounded-xl border border-border bg-panel2 p-6 text-sm text-text-dim">
              Reading recent projects...
            </div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border bg-panel2 p-8 text-center panel-padding-left panel-padding-right panel-padding-top panel-padding-bottom">
              <p className="text-sm text-text">No recent projects yet.</p>
              <p className="mt-2 text-xs text-text-dim">
                Save a `.sbn` project package to see thumbnail previews here.
              </p>
            </div>
          ) : null}

          {items.map((preview) => (
            <div
              key={preview.path}
              className="overflow-hidden rounded-xl border border-border bg-panel2 margin-top-lg margin-bottom-lg margin-left-lg "
            >
              <button
                onClick={() => void handleOpenRecent(preview.path)}
                className="block w-full text-left"
                title={preview.path}
              >
                <div className="aspect-square overflow-hidden bg-[#11111b]">
                  {preview.thumbnailDataUrl ? (
                    <img
                      src={preview.thumbnailDataUrl}
                      alt={preview.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#121221,#1d1d31)] text-text-dim">
                      {preview.format === 'package' ? <Package size={42} /> : <FileJson size={42} />}
                    </div>
                  )}
                </div>
              </button>

              <div className="space-y-2 panel-padding-left panel-padding-right panel-padding-top panel-padding-bottom">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text">{preview.name}</div>
                    <div className="mt-1 text-[11px] text-text-dim">
                      {preview.format === 'package' ? '.sbn package' : 'Legacy JSON'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-panel px-2 py-1 text-[10px] text-text-dim">
                    v{preview.projectVersion}
                  </div>
                </div>

                  <div className="space-y-1 text-[11px] text-text-dim">
                  <div className="truncate">{preview.path}</div>
                  <div>
                    Archive: {preview.archiveVersion ?? '-'}
                    {preview.updatedAt ? ` | Saved: ${new Date(preview.updatedAt).toLocaleString()}` : ''}
                  </div>
                </div>

                <div className="flex gap-2 panel-padding-top">
                  <button
                    onClick={() => void handleOpenRecent(preview.path)}
                    className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition hover:opacity-90"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => {
                      removeRecentProject(preview.path);
                      setItems((current) => current.filter((item) => item.path !== preview.path));
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-text-dim transition hover:bg-panel hover:text-text"
                    title="Remove from recent projects"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
