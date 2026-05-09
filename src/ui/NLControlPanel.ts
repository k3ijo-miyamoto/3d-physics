export interface NLPanelCallbacks {
  onClearEffects: () => void;
}

export class NLControlPanel {
  private panel: HTMLDivElement;
  private fieldsEl: HTMLDivElement;
  private mcpIndicator: HTMLSpanElement;

  constructor(container: HTMLElement, callbacks: NLPanelCallbacks) {
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      width: '280px',
      background: 'rgba(20,20,30,0.92)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '8px',
      padding: '12px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#ddd',
      zIndex: '1000',
      backdropFilter: 'blur(6px)',
    });

    this.panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;color:#fff;font-size:14px;display:flex;align-items:center;gap:8px">
        AI Physics Control
        <span id="mcp-indicator" style="font-size:10px;padding:2px 6px;border-radius:10px;background:#374151;color:#9ca3af;font-weight:500">Claude CLI ✕</span>
      </div>
      <div style="color:#94a3b8;font-size:11px;line-height:1.5;margin-bottom:8px">
        Claude CLI が接続されたら、ターミナルで自然言語で指示できます。<br>
        例: <span style="color:#7dd3fc">台風を起こして球を10個追加して</span>
      </div>
    `;
    this.mcpIndicator = this.panel.querySelector('#mcp-indicator') as HTMLSpanElement;

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'エフェクトをクリア';
    Object.assign(clearBtn.style, {
      width: '100%',
      padding: '5px 8px',
      background: '#374151',
      color: '#d1d5db',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '600',
    });
    clearBtn.addEventListener('click', () => {
      callbacks.onClearEffects();
      this.fieldsEl.textContent = '';
    });
    this.panel.appendChild(clearBtn);

    this.fieldsEl = document.createElement('div');
    Object.assign(this.fieldsEl.style, {
      marginTop: '8px',
      fontSize: '11px',
      color: '#7dd3fc',
      minHeight: '16px',
    });
    this.panel.appendChild(this.fieldsEl);

    container.appendChild(this.panel);
  }

  updateActiveFields(fields: string[]): void {
    this.fieldsEl.textContent = fields.length
      ? `アクティブ: ${fields.join(' / ')}`
      : '';
  }

  setMcpConnected(connected: boolean): void {
    if (connected) {
      Object.assign(this.mcpIndicator.style, { background: '#14532d', color: '#86efac' });
      this.mcpIndicator.textContent = 'Claude CLI ✓';
    } else {
      Object.assign(this.mcpIndicator.style, { background: '#374151', color: '#9ca3af' });
      this.mcpIndicator.textContent = 'Claude CLI ✕';
    }
  }
}
