import { useState } from 'react';
import { X } from 'lucide-react';

interface PngSequenceExportDialogProps {
  onExport: (settings: { resolution: number }) => void;
  onClose: () => void;
}

export const PngSequenceExportDialog = ({
  onExport,
  onClose,
}: PngSequenceExportDialogProps) => {
  const [resolution, setResolution] = useState('1024');

  const handleExport = () => {
    const parsedResolution = Number.parseInt(resolution, 10);

    if (!Number.isFinite(parsedResolution) || parsedResolution < 64) {
      alert('Please enter a valid resolution of at least 64 pixels.');
      return;
    }

    onExport({ resolution: parsedResolution });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleExport();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-border rounded-lg shadow-xl w-[400px] max-h-[80vh] overflow-auto panel-padding-top-lg panel-padding-left panel-padding-right panel-padding-bottom"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border panel-padding-bottom">
          <h2 className="text-sm font-medium text-text">PNG Sequence Export Settings</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text mb-1.5">
              Frame Resolution (pixels)
            </label>
            <input
              type="number"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full px-3 py-2 bg-panel2 border border-border rounded text-text text-sm focus:outline-none focus:border-accent"
              placeholder="1024"
              min="64"
              autoFocus
            />
            <p className="text-xs text-text-dim mt-1">
              Square resolution for each frame. Examples: 512, 1024, 1536
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border panel-padding-top">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded border border-border bg-transparent text-text hover:bg-panel2 transition-all text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 rounded border border-accent bg-accent text-white hover:bg-accent/90 transition-all text-xs"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
