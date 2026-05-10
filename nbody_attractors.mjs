/**
 * N体引力シミュレーター for 収斂点
 * 収斂点同士が互いに引き合い、床反発、壁反発しながら動く
 * WebSocket bridge 経由でシミュレーションに送信
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:5175');

// ---- パラメータ ----
const G         = 800;    // 引力定数（大きいほど強く引き合う）
const DAMPING   = 0.98;   // 速度の減衰（1=減衰なし）
const MIN_DIST  = 5;      // 最小距離クランプ（特異点回避）
const FLOOR_Y   = 1;      // 床の高さ
const FIELD     = 80;     // フィールド端 ±80m
const STRENGTH  = 22;     // 球への引力強度
const DT        = 0.1;    // 更新間隔 (s)

// ---- 初期配置（10点をフィールドに散らばせる）----
const attractors = [
  { x: -45, y: 10, z: -35, vx: 2,  vy: 0, vz: 1  },
  { x:  48, y: 14, z:  20, vx: -1, vy: 0, vz: -2 },
  { x:  10, y:  8, z: -52, vx: 1,  vy: 0, vz: 2  },
  { x: -50, y: 12, z:  40, vx: 2,  vy: 0, vz: -1 },
  { x:  52, y:  9, z:  -8, vx: -2, vy: 0, vz: 1  },
  { x: -20, y: 16, z:  55, vx: 1,  vy: 0, vz: -2 },
  { x:  35, y: 11, z: -48, vx: -1, vy: 0, vz: 1  },
  { x: -55, y:  7, z: -20, vx: 2,  vy: 0, vz: 2  },
  { x:  15, y: 18, z:  50, vx: -2, vy: 0, vz: -1 },
  { x: -30, y: 10, z: -55, vx: 1,  vy: 0, vz: 2  },
];

function step() {
  const n = attractors.length;

  // 各引力点に働く力を計算
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);
  const fz = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = attractors[j].x - attractors[i].x;
      const dy = attractors[j].y - attractors[i].y;
      const dz = attractors[j].z - attractors[i].z;
      const dist = Math.max(Math.sqrt(dx*dx + dy*dy + dz*dz), MIN_DIST);
      const f = G / (dist * dist);
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      fx[i] += nx * f; fy[i] += ny * f; fz[i] += nz * f;
      fx[j] -= nx * f; fy[j] -= ny * f; fz[j] -= nz * f;
    }
  }

  // 速度・位置を更新
  for (let i = 0; i < n; i++) {
    const a = attractors[i];
    a.vx = (a.vx + fx[i] * DT) * DAMPING;
    a.vy = (a.vy + fy[i] * DT) * DAMPING;
    a.vz = (a.vz + fz[i] * DT) * DAMPING;
    a.x += a.vx * DT;
    a.y += a.vy * DT;
    a.z += a.vz * DT;

    // 床反発
    if (a.y < FLOOR_Y) { a.y = FLOOR_Y; a.vy = Math.abs(a.vy) * 0.5; }
    // 壁反発
    if (a.x >  FIELD) { a.x =  FIELD; a.vx = -Math.abs(a.vx) * 0.7; }
    if (a.x < -FIELD) { a.x = -FIELD; a.vx =  Math.abs(a.vx) * 0.7; }
    if (a.z >  FIELD) { a.z =  FIELD; a.vz = -Math.abs(a.vz) * 0.7; }
    if (a.z < -FIELD) { a.z = -FIELD; a.vz =  Math.abs(a.vz) * 0.7; }
  }

  // ブリッジへ送信
  const points = attractors.map(a => ({ x: a.x, y: a.y, z: a.z, strength: STRENGTH }));
  ws.send(JSON.stringify({ type: 'set_attractors', points }));
}

ws.on('open', () => {
  process.stderr.write('[nbody] connected — 10点の相互引力シミュレーション開始\n');
  setInterval(step, DT * 1000);
});
ws.on('close', () => process.stderr.write('[nbody] disconnected\n'));
ws.on('error', () => {});
