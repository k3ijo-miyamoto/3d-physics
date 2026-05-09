/**
 * Physics Simulation MCP Server
 *
 * Connects as a WebSocket CLIENT to the bridge started by `npm run dev`.
 * Exposes physics simulation controls as MCP tools for Claude CLI.
 *
 * Registration (one-time):
 *   claude mcp add physics-sim -- npx tsx /path/to/mcp/server.ts
 *
 * The Vite dev server (`npm run dev`) must be running for the bridge to be available.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';

const BRIDGE_URL = 'ws://localhost:5175';
const RECONNECT_DELAY = 3000;
const STATE_TIMEOUT = 5000;

// ---------- Bridge client ----------

let ws: WebSocket | null = null;
const pendingState = new Map<string, (s: unknown) => void>();

function connect() {
  ws = new WebSocket(BRIDGE_URL);

  ws.on('open', () => {
    process.stderr.write('[physics-mcp] Connected to bridge\n');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; requestId?: string; state?: unknown };
      if (msg.type === 'state_response' && msg.requestId) {
        pendingState.get(msg.requestId)?.(msg.state);
        pendingState.delete(msg.requestId);
      }
    } catch {
      // ignore malformed
    }
  });

  ws.on('close', () => {
    ws = null;
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', () => {
    // 'close' fires after 'error', reconnect logic is there
  });
}

function send(payload: unknown): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function requestState(): Promise<unknown> {
  const requestId = `req_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingState.delete(requestId);
      reject(new Error('タイムアウト — ブラウザとブリッジが起動していることを確認してください'));
    }, STATE_TIMEOUT);
    pendingState.set(requestId, (s) => {
      clearTimeout(timer);
      resolve(s);
    });
    send({ type: 'get_state', requestId });
  });
}

connect();

// ---------- Helpers ----------

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function notConnected() {
  return {
    content: [{ type: 'text' as const, text: '接続エラー: `npm run dev` が起動しているか確認してください' }],
    isError: true,
  };
}

// ---------- MCP server ----------

const server = new Server(
  { name: 'physics-simulation', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'add_sphere',
      description: 'シミュレーションに球を追加する',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '追加する球の数 (デフォルト: 1)', default: 1 },
          height: { type: 'number', description: '初期高さ (m, デフォルト: 5)', default: 5 },
        },
      },
    },
    {
      name: 'remove_all_spheres',
      description: '全ての球を削除する',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'reset_simulation',
      description: 'シミュレーションをリセットする',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'pause_simulation',
      description: 'シミュレーションを一時停止する',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'resume_simulation',
      description: 'シミュレーションを再開する',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_gravity',
      description: '重力を設定する。負=下向き、0=無重力、正=上向き',
      inputSchema: {
        type: 'object',
        properties: { y: { type: 'number', description: '重力Y値 (デフォルト: -9.81)' } },
        required: ['y'],
      },
    },
    {
      name: 'set_restitution',
      description: '反発係数を設定する (0=跳ねない, 1=完全弾性)',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['value'],
      },
    },
    {
      name: 'set_damping',
      description: '減衰を設定する (0.9=大きく減衰, 0.999=ほぼなし)',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'number', minimum: 0.9, maximum: 1 } },
        required: ['value'],
      },
    },
    {
      name: 'apply_wind',
      description: '一定方向の風力場を適用する',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', default: 0 },
          y: { type: 'number', default: 0 },
          z: { type: 'number', default: 0 },
          duration: { type: 'number', description: '持続秒数 (-1で永続)', default: -1 },
        },
      },
    },
    {
      name: 'apply_vortex',
      description: '渦/台風/竜巻の回転力場を適用する',
      inputSchema: {
        type: 'object',
        properties: {
          tangentialStrength: { type: 'number', description: '回転強度 5–25', default: 15 },
          inwardStrength: { type: 'number', description: '内向き引力 0–10', default: 3 },
          liftStrength: { type: 'number', description: '中心付近の上昇 0–12', default: 6 },
          centerX: { type: 'number', default: 0 },
          centerZ: { type: 'number', default: 0 },
          duration: { type: 'number', default: -1 },
        },
      },
    },
    {
      name: 'apply_explosion',
      description: '爆発の衝撃を発生させる（一発）',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', default: 0 },
          y: { type: 'number', default: 0 },
          z: { type: 'number', default: 0 },
          strength: { type: 'number', description: '爆発強度 10–60', default: 25 },
          radius: { type: 'number', description: '影響半径 (m)', default: 10 },
        },
      },
    },
    {
      name: 'apply_attraction',
      description: '特定の点への引力場を適用する',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', default: 0 },
          y: { type: 'number', default: 5 },
          z: { type: 'number', default: 0 },
          strength: { type: 'number', description: '引力強度 2–20', default: 10 },
          duration: { type: 'number', default: -1 },
        },
      },
    },
    {
      name: 'clear_effects',
      description: '全ての力場をクリアする',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'start_auto_explosion',
      description: '5秒ごとに自動爆発を開始する',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'stop_auto_explosion',
      description: '自動爆発を停止する',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_attractors',
      description: '5つの収斂点（引力ウェル）を設定する。xyz=位置, strength=引力強度 (0=無効)',
      inputSchema: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            description: '最大5個の引力点。足りない場合は無効(strength=0)で補完',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number' },
                strength: { type: 'number', description: '引力強度 5–30' },
              },
              required: ['x', 'y', 'z', 'strength'],
            },
          },
        },
        required: ['points'],
      },
    },
    {
      name: 'get_state',
      description: '現在のシミュレーション状態を取得する',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const a = (req.params.arguments ?? {}) as Record<string, number>;

  switch (name) {
    case 'add_sphere': {
      const count = Math.max(1, Math.round(a.count ?? 1));
      // Use bulk command for any count — single GPU write instead of N messages
      const sent = send({ type: 'add_spheres_bulk', count });
      return sent ? ok(`${count} 個の球を追加しました`) : notConnected();
    }
    case 'remove_all_spheres':
      return send({ type: 'remove_all_spheres' }) ? ok('全ての球を削除しました') : notConnected();

    case 'reset_simulation':
      return send({ type: 'reset_simulation' }) ? ok('リセットしました') : notConnected();

    case 'pause_simulation':
      return send({ type: 'pause_simulation' }) ? ok('一時停止しました') : notConnected();

    case 'resume_simulation':
      return send({ type: 'resume_simulation' }) ? ok('再開しました') : notConnected();

    case 'set_gravity':
      return send({ type: 'set_gravity', y: a.y }) ? ok(`重力を ${a.y} m/s² に設定しました`) : notConnected();

    case 'set_restitution':
      return send({ type: 'set_restitution', value: a.value }) ? ok(`反発係数を ${a.value} に設定しました`) : notConnected();

    case 'set_damping':
      return send({ type: 'set_damping', value: a.value }) ? ok(`減衰を ${a.value} に設定しました`) : notConnected();

    case 'apply_wind':
      return send({
        type: 'apply_force_field',
        field: { type: 'wind', force: [a.x ?? 0, a.y ?? 0, a.z ?? 0], duration: a.duration ?? -1 },
      }) ? ok(`風を適用しました (${a.x ?? 0}, ${a.y ?? 0}, ${a.z ?? 0})`) : notConnected();

    case 'apply_vortex':
      return send({
        type: 'apply_force_field',
        field: {
          type: 'vortex',
          center: [a.centerX ?? 0, 0, a.centerZ ?? 0],
          tangentialStrength: a.tangentialStrength ?? 15,
          inwardStrength: a.inwardStrength ?? 3,
          liftStrength: a.liftStrength ?? 6,
          duration: a.duration ?? -1,
        },
      }) ? ok('台風/渦を適用しました') : notConnected();

    case 'apply_explosion':
      return send({
        type: 'apply_force_field',
        field: {
          type: 'explosion',
          center: [a.x ?? 0, a.y ?? 0, a.z ?? 0],
          strength: a.strength ?? 25,
          radius: a.radius ?? 10,
          duration: 0.1,
        },
      }) ? ok('爆発を発生させました') : notConnected();

    case 'apply_attraction':
      return send({
        type: 'apply_force_field',
        field: {
          type: 'attraction',
          center: [a.x ?? 0, a.y ?? 5, a.z ?? 0],
          strength: a.strength ?? 10,
          duration: a.duration ?? -1,
        },
      }) ? ok('引力場を適用しました') : notConnected();

    case 'clear_effects':
      return send({ type: 'clear_effects' }) ? ok('全エフェクトをクリアしました') : notConnected();

    case 'start_auto_explosion':
      return send({ type: 'start_auto_explosion' }) ? ok('5秒ごとの自動爆発を開始しました') : notConnected();

    case 'stop_auto_explosion':
      return send({ type: 'stop_auto_explosion' }) ? ok('自動爆発を停止しました') : notConnected();

    case 'set_attractors': {
      const rawPoints = (req.params.arguments as { points?: unknown })?.points;
      const pts = Array.isArray(rawPoints) ? rawPoints : [];
      const full: Array<{ x: number; y: number; z: number; strength: number }> = [];
      for (let i = 0; i < 5; i++) {
        const p = pts[i] as { x?: number; y?: number; z?: number; strength?: number } | undefined;
        full.push(p ? { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0, strength: p.strength ?? 0 } : { x: 0, y: 0, z: 0, strength: 0 });
      }
      return send({ type: 'set_attractors', points: full }) ? ok(`${pts.length} 個の収斂点を設定しました`) : notConnected();
    }

    case 'get_state': {
      if (!ws || ws.readyState !== WebSocket.OPEN) return notConnected();
      try {
        const state = await requestState();
        return ok(JSON.stringify(state, null, 2));
      } catch (err) {
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true };
      }
    }

    default:
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write('[physics-mcp] MCP server ready. Connecting to bridge...\n');
});
