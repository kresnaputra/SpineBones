import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Copy, Square, Play, Settings2, X } from 'lucide-react';
import {
  getMcpBridgeInfo,
  getMcpServerStatus,
  isDesktopApp,
  startMcpServer,
  stopMcpServer,
  type McpBridgeInfo,
  type McpServerStatus,
} from '../../utils/nativeIO';

export const AiMcpPanel = () => {
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [bridgeInfo, setBridgeInfo] = useState<McpBridgeInfo | null>(null);
  const [bridgeHealth, setBridgeHealth] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [bridgeMessage, setBridgeMessage] = useState('Bridge not checked.');
  const [serverStatus, setServerStatus] = useState<McpServerStatus | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [showCodexConfig, setShowCodexConfig] = useState(false);
  const launchCommand = useMemo(() => {
    if (serverStatus?.command) return serverStatus.command;
    return serverStatus?.serverUrl || 'http://127.0.0.1:<mcp-port>/mcp';
  }, [bridgeUrl, serverStatus]);
  const codexConfigSummary = useMemo(() => {
    return [
      'Transport: Streamable HTTP',
      `URL: ${serverStatus?.serverUrl || 'http://127.0.0.1:<mcp-port>/mcp'}`,
      'Authentication: none',
    ].join('\n');
  }, [serverStatus]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    void getMcpBridgeInfo()
      .then((info) => {
        if (info?.url) {
          setBridgeInfo(info);
          setBridgeUrl(info.url);
          setBridgeMessage(`Bridge ready at ${info.url}`);
        }
      })
      .catch((error) => {
        console.error('Failed to get MCP bridge info:', error);
        setBridgeMessage('Unable to read bridge info.');
      });

    void getMcpServerStatus()
      .then((status) => {
        if (status) {
          setServerStatus(status);
        }
      })
      .catch((error) => {
        console.error('Failed to read MCP server status:', error);
      });
  }, []);

  const handleCheckBridge = async () => {
    if (!bridgeUrl) return;
    setBridgeHealth('checking');
    setBridgeMessage('Checking bridge...');

    try {
      const response = await fetch(`${bridgeUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      setBridgeHealth('online');
      setBridgeMessage(`Bridge online at ${bridgeUrl} (${payload.port})`);
      const info = await getMcpBridgeInfo();
      if (info) {
        setBridgeInfo(info);
      }
    } catch (error) {
      console.error('Failed to check MCP bridge:', error);
      setBridgeHealth('offline');
      setBridgeMessage(`Bridge unavailable at ${bridgeUrl}`);
    }
  };

  const handleCopyLaunchCommand = async () => {
    try {
      await navigator.clipboard.writeText(launchCommand);
      setBridgeMessage('MCP URL copied.');
    } catch (error) {
      console.error('Failed to copy MCP command:', error);
      setBridgeMessage(`Copy failed. MCP URL: ${launchCommand}`);
    }
  };

  const refreshServerStatus = async () => {
    try {
      const [status, info] = await Promise.all([getMcpServerStatus(), getMcpBridgeInfo()]);
      if (status) {
        setServerStatus(status);
      }
      if (info) {
        setBridgeInfo(info);
      }
    } catch (error) {
      console.error('Failed to refresh MCP server status:', error);
      setBridgeMessage('Unable to read MCP status.');
    }
  };

  const handleStartServer = async () => {
    setServerBusy(true);
    try {
      const status = await startMcpServer();
      if (status) {
        setServerStatus(status);
        setBridgeMessage(status.running
          ? `MCP running${status.pid ? ` (PID ${status.pid})` : ''}.`
          : 'MCP not running.');
      }
    } catch (error) {
      console.error('Failed to start MCP server:', error);
      setBridgeMessage(`Failed to start MCP: ${error}`);
      await refreshServerStatus();
    } finally {
      setServerBusy(false);
    }
  };

  const handleStopServer = async () => {
    setServerBusy(true);
    try {
      await stopMcpServer();
      setBridgeMessage('MCP stopped.');
      await refreshServerStatus();
    } catch (error) {
      console.error('Failed to stop MCP server:', error);
      setBridgeMessage(`Failed to stop MCP: ${error}`);
    } finally {
      setServerBusy(false);
    }
  };

  return (
    <div className="relative flex flex-col border-t border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider bg-panel2 panel-padding-left flex items-center gap-2">
        <Bot size={12} />
        MCP Server
      </div>

      <div className="panel-padding-left p-3 flex flex-col gap-3 text-[11px] text-text-dim">
        <div className="rounded border border-border bg-panel2/70 p-3">
          <div className="flex items-center gap-2 text-text text-[11px] font-semibold">
            <Activity size={13} className="text-accent2" />
            MCP Bridge
          </div>

          <div className="mt-2 rounded border border-border/70 bg-panel px-2 py-2 font-mono text-[10px] leading-5 text-text-dim break-all">
            {bridgeUrl ?? 'http://127.0.0.1:<port>'}
          </div>

          <div className="mt-2 flex gap-2">
            <button
              onClick={handleCheckBridge}
              disabled={!bridgeUrl || bridgeHealth === 'checking'}
              className="flex-1 rounded border border-border bg-panel px-3 py-2 text-[11px] font-semibold text-text transition-all hover:border-accent hover:text-accent2 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text"
            >
              {bridgeHealth === 'checking' ? 'Checking...' : 'Check Bridge'}
            </button>

            <button
              onClick={handleCopyLaunchCommand}
              disabled={!bridgeUrl}
              className="flex items-center justify-center gap-1 rounded border border-accent/60 bg-accent/15 px-3 py-2 text-[11px] font-semibold text-accent2 transition-all hover:bg-accent/20 disabled:opacity-40 disabled:hover:bg-accent/15"
            >
              <Copy size={12} />
              Copy URL
            </button>
          </div>

          <button
            onClick={() => setShowCodexConfig(true)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-border bg-panel px-3 py-2 text-[11px] font-semibold text-text transition-all hover:border-accent hover:text-accent2"
          >
            <Settings2 size={12} />
            MCP Config
          </button>

          <div className="mt-2 rounded border border-border/70 bg-panel px-2 py-2 font-mono text-[10px] leading-5 text-text-dim break-all">
            {serverStatus?.serverUrl ?? 'http://127.0.0.1:<mcp-port>/mcp'}
          </div>

          <div className="mt-2 rounded border border-border/70 bg-panel px-2 py-2 text-[10px] leading-5 text-text-dim">
            App MCP:{' '}
            <span className={serverStatus?.running ? 'text-green-400' : 'text-text'}>
              {serverStatus?.running ? 'Running' : 'Stopped'}
            </span>
            {serverStatus?.pid ? ` | PID ${serverStatus.pid}` : ''}
          </div>

          <div className="mt-2 flex gap-2">
            <button
              onClick={handleStartServer}
              disabled={!bridgeUrl || serverBusy || !!serverStatus?.running}
              className="flex-1 rounded border border-accent/60 bg-accent/15 px-3 py-2 text-[11px] font-semibold text-accent2 transition-all hover:bg-accent/20 disabled:opacity-40 disabled:hover:bg-accent/15 flex items-center justify-center gap-1"
            >
              <Play size={12} />
              Start MCP
            </button>
            <button
              onClick={handleStopServer}
              disabled={serverBusy || !serverStatus?.running}
              className="flex-1 rounded border border-border bg-panel px-3 py-2 text-[11px] font-semibold text-text transition-all hover:border-accent hover:text-accent2 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text flex items-center justify-center gap-1"
            >
              <Square size={12} />
              Stop MCP
            </button>
          </div>

          {serverStatus?.lastError ? (
            <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[10px] leading-5 text-red-200">
              {serverStatus.lastError}
            </div>
          ) : null}

          <div className="mt-2 text-[10px] leading-5 text-text-dim">
            {bridgeMessage}
          </div>
        </div>
      </div>

      {showCodexConfig ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-3">
          <div className="w-full max-w-[320px] rounded-lg border border-border bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-panel2 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                <Settings2 size={13} className="text-accent2" />
                MCP Config
              </div>
              <button
                onClick={() => setShowCodexConfig(false)}
                className="rounded border border-border bg-panel px-2 py-1 text-text-dim transition-all hover:border-accent hover:text-text"
              >
                <X size={12} />
              </button>
            </div>

            <div className="space-y-2 p-3">
              <div className="rounded border border-border/70 bg-panel2/70 px-2 py-2 text-[10px] leading-5 text-text-dim">
                Use this when adding the MCP server.
              </div>

              <div className="rounded border border-border/70 bg-panel px-2 py-2 font-mono text-[10px] leading-5 text-text-dim whitespace-pre-wrap break-all">
                {codexConfigSummary}
              </div>

              <button
                onClick={handleCopyLaunchCommand}
                className="flex w-full items-center justify-center gap-1 rounded border border-accent/60 bg-accent/15 px-3 py-2 text-[11px] font-semibold text-accent2 transition-all hover:bg-accent/20"
              >
                <Copy size={12} />
                Copy MCP URL
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
