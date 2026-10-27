import { useEffect, useRef, useState } from 'react';
import { Ghostty, Terminal, FitAddon } from 'ghostty-web';
import wasmUrl from 'ghostty-web/ghostty-vt.wasm?url';

type Transport = {
  attach(id: string): Promise<{ seq: number; buffer: string; running: boolean }>;
  write(id: string, bytes: string): void;
  resize(id: string, cols: number, rows: number): void;
  onTerminal(fn: (event: { id: string; seq?: number; data?: string; exit?: boolean }) => void): () => void;
};

const ghosttyReady = Ghostty.load(wasmUrl);

export function TerminalPane({ id, running, bridge }: {
  id: string; running: boolean; bridge: Transport;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const host = node.current;
    if (!host) return;
    let disposed = false;
    let attached = false;
    let sequence = 0;
    const pending: Array<{ seq?: number; data?: string }> = [];
    let terminal: Terminal | null = null;
    let fit: FitAddon | null = null;
    let inputDispose: { dispose(): void } | null = null;
    let resizeDispose: { dispose(): void } | null = null;

    const deliver = (event: { seq?: number; data?: string }) => {
      if (!terminal || !event.data) return;
      if (event.seq !== undefined && event.seq <= sequence) return;
      terminal.write(event.data);
      if (event.seq !== undefined) sequence = event.seq;
    };
    const off = bridge.onTerminal(event => {
      if (event.id !== id || event.exit || !event.data) return;
      if (!attached) pending.push(event);
      else deliver(event);
    });
    void (async () => {
      try {
        const ghostty = await ghosttyReady;
        if (disposed || !host) return;
        terminal = new Terminal({
          ghostty, fontSize: 13, fontFamily: 'Menlo, Monaco, monospace',
          cursorBlink: true, scrollback: 6000,
          theme: { background: '#10151d', foreground: '#d7e1ed' },
        });
        fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host);
        inputDispose = terminal.onData(data => bridge.write(id, data));
        resizeDispose = terminal.onResize(({ cols, rows }) => bridge.resize(id, cols, rows));
        const snapshot = await bridge.attach(id);
        if (disposed) return;
        sequence = snapshot.seq;
        if (snapshot.buffer) terminal.write(snapshot.buffer);
        attached = true;
        pending.filter(event => event.seq === undefined || event.seq > sequence)
          .sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach(deliver);
        fit.fit();
        fit.observeResize();
        bridge.resize(id, terminal.cols, terminal.rows);
        if (running) terminal.focus();
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      disposed = true;
      off();
      inputDispose?.dispose();
      resizeDispose?.dispose();
      fit?.dispose();
      terminal?.dispose();
      host.replaceChildren();
    };
  }, [bridge, id, running]);

  return <div className="terminal-wrapper">
    <div className="terminal-host" ref={node}/>
    {loadError && <div className="terminal-error">Ghostty 터미널 초기화 실패: {loadError}</div>}
  </div>;
}
