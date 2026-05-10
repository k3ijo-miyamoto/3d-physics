# 3D WebGPU Physics Simulation

An AI-controllable large-scale 3D rigid body physics sandbox built with WebGPU compute shaders and TypeScript.  
Simulate up to **3 million spheres** in real time, and control the simulation live via Claude through an MCP server.

---

## Features

- **WebGPU physics** — compute shader integration/collision pipeline running entirely on the GPU
- **3 million spheres** at real-time frame rates
- **Spatial hash collision** — O(n) broadphase covering ±48 m × 64 m × ±48 m
- **Force fields** — wind, vortex/tornado, explosion, point attraction
- **32-slot attractor wells** — gravity wells written directly to the GPU uniform buffer
- **GPU stats reduction** — average speed, max speed, total kinetic energy, center of mass (256-workgroup parallel reduction)
- **MCP server** — Claude CLI controls the simulation through structured tool calls
- **WebSocket bridge** — MCP server, browser, and Node.js scripts share a single relay on `ws://localhost:5175`
- **Scenario system** — record and replay command sequences as JSON
- **CPU fallback** — Three.js renderer for environments without WebGPU

## Demo

> Click the image below to watch on YouTube.

[![3D WebGPU Physics Simulation — 3M spheres, attractor spiral & black hole](https://img.youtube.com/vi/dLX3tjRpqsg/maxresdefault.jpg)](https://www.youtube.com/watch?v=dLX3tjRpqsg)

---

## Requirements

- Node.js 20+
- A browser with WebGPU support (Chrome 113+, Edge 113+)
- GPU with WebGPU driver support

---

## Setup

```bash
git clone <repo>
cd 3d-physics
npm install
```

---

## Usage

### Development server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser and click **GPU モード ON** to activate WebGPU mode.  
The WebSocket bridge starts automatically on `ws://localhost:5175`.

### MCP server (Claude integration)

Register once:

```bash
claude mcp add physics-sim -- npx tsx /path/to/3d-physics/mcp/server.ts
```

Then start the server alongside the dev server:

```bash
npm run mcp
```

The MCP server connects to the bridge as a WebSocket client.  
`npm run dev` must be running for the bridge to be available.

---

## MCP Tools

| Tool | Description |
|---|---|
| `add_sphere` | Add spheres (`count`, `height`) |
| `remove_spheres` | Remove last N spheres |
| `remove_all_spheres` | Remove all spheres |
| `reset_simulation` | Reset to initial state |
| `pause_simulation` / `resume_simulation` | Pause / resume |
| `set_gravity` | Set gravity Y value |
| `set_restitution` | Restitution coefficient (0–1) |
| `set_damping` | Linear damping (0.9–1.0) |
| `apply_wind` | Apply a constant wind force field |
| `apply_vortex` | Apply a rotating vortex / tornado field |
| `apply_explosion` | Fire an outward impulse from a point |
| `apply_attraction` | Apply a single point attraction field |
| `set_attractors` | Set up to 32 attractor wells at once |
| `clear_effects` | Clear all active force fields |
| `start_auto_explosion` / `stop_auto_explosion` | Automatic explosion every 3 s |
| `get_state` | Get sphere count, attractor positions, GPU stats |

---

## External Scripts

These scripts connect directly to `ws://localhost:5175` and bypass the MCP server,  
which is useful when the MCP server process has stale code or you need more than 5 attractors.

| Script | Description |
|---|---|
| `nbody_attractors.mjs` | 10 attractor wells with mutual N-body gravity |
| `spiral_attractors.mjs` | Move attractor wells in spiral / elliptical orbits |
| `auto_attract.mjs` | Periodically auto-set attraction fields |
| `record_scenario.mjs` | Record a command sequence to JSON |
| `run_scenario.mjs` | Replay a recorded scenario |

```bash
node nbody_attractors.mjs
node run_scenario.mjs scenarios/bigbang_collapse.json
```

---

## Architecture

```
Claude CLI
    │ stdio
    ▼
MCP Server  (mcp/server.ts)
    │ WebSocket
    ▼
Bridge      (vite plugin, ws://localhost:5175)  ◄── Node.js scripts
    │ WebSocket
    ▼
Browser     (SimulationBridge.ts)
    │
    ├── GPUPhysicsWorld   — WGSL compute shaders (integrate · collide · stats)
    └── WebGPUSceneRenderer — GPU billboard rendering, attractor glow markers
```

### GPU params buffer layout (640 bytes)

```
[0–127]   8 × vec4f  gravity / config / wind / vortex / walls / explosion
[128–639] 32 × vec4f attractor wells  (xyz = position, w = strength)
```

### Attractor strength guide

| Scenario | Recommended strength |
|---|---|
| Zero gravity, distance 50 m | 200–500 |
| Normal gravity (−9.81), distance 50 m | 500+ (gravity dominates) |
| Zero gravity, tight clustering | 50–150 |

---

## Tech Stack

| | |
|---|---|
| Physics | Custom WGSL compute shaders (no physics engine library) |
| Rendering | WebGPU (GPU mode) / Three.js (CPU fallback) |
| Language | TypeScript |
| Bundler | Vite |
| UI | lil-gui |
| MCP | @modelcontextprotocol/sdk |
| AI SDK | @anthropic-ai/sdk |
| Tests | Vitest |

---

---

# 3D WebGPU 物理シミュレーション

WebGPU compute shader と TypeScript で構築した、AI制御対応の大規模 3D 剛体物理サンドボックスです。  
最大 **300万球** をリアルタイムシミュレーションし、MCP サーバー経由で Claude がライブ操作できます。

---

## 機能

- **WebGPU 物理演算** — 積分・衝突パイプラインを全て GPU 上で実行する compute shader
- **300万球** をリアルタイムフレームレートで処理
- **空間ハッシュ衝突検出** — ±48 m × 64 m × ±48 m をカバーする O(n) ブロードフェーズ
- **フォースフィールド** — 風・渦/竜巻・爆発・点引力
- **32スロット引力ウェル** — GPU uniform バッファに直接書き込む重力井戸
- **GPU stats リダクション** — 平均速度・最高速度・全運動エネルギー・重心を 256 ワークグループ並列で計算
- **MCP サーバー** — Claude CLI がシミュレーションを構造化ツール呼び出しで操作
- **WebSocket ブリッジ** — MCP サーバー・ブラウザ・Node.js スクリプトが `ws://localhost:5175` を共有
- **シナリオシステム** — コマンドシーケンスを JSON として録音・再生
- **CPU フォールバック** — WebGPU 非対応環境向けの Three.js レンダラー

## デモ

> 下の画像をクリックすると YouTube で視聴できます。

[![3D WebGPU 物理シミュレーション — 300万球、引力スパイラル＆ブラックホール](https://img.youtube.com/vi/dLX3tjRpqsg/maxresdefault.jpg)](https://www.youtube.com/watch?v=dLX3tjRpqsg)

---

## 動作要件

- Node.js 20 以上
- WebGPU 対応ブラウザ（Chrome 113+、Edge 113+）
- WebGPU ドライバ対応 GPU

---

## セットアップ

```bash
git clone <repo>
cd 3d-physics
npm install
```

---

## 使い方

### 開発サーバー

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開き、**GPU モード ON** ボタンをクリックして WebGPU モードを有効化します。  
WebSocket ブリッジは `ws://localhost:5175` で自動起動します。

### MCP サーバー（Claude 連携）

初回のみ登録:

```bash
claude mcp add physics-sim -- npx tsx /path/to/3d-physics/mcp/server.ts
```

開発サーバーと並行して起動:

```bash
npm run mcp
```

MCP サーバーはブリッジに WebSocket クライアントとして接続します。  
ブリッジを使うには `npm run dev` が起動している必要があります。

> **注意:** MCP サーバーは長時間プロセスです。コードを変更した場合は再起動が必要です。

---

## MCP ツール一覧

| ツール | 説明 |
|---|---|
| `add_sphere` | 球を追加（count, height） |
| `remove_spheres` | 最後に追加した N 個を削除 |
| `remove_all_spheres` | 全球削除 |
| `reset_simulation` | 初期状態にリセット |
| `pause_simulation` / `resume_simulation` | 一時停止 / 再開 |
| `set_gravity` | 重力 Y 値を設定 |
| `set_restitution` | 反発係数（0–1） |
| `set_damping` | 線形減衰（0.9–1.0） |
| `apply_wind` | 一定方向の風力場を適用 |
| `apply_vortex` | 渦・竜巻の回転力場を適用 |
| `apply_explosion` | 点から外向きの瞬間衝撃を発生 |
| `apply_attraction` | 単一の点引力場を適用 |
| `set_attractors` | 最大 32 個の引力ウェルを一括設定 |
| `clear_effects` | 全フォースフィールドをクリア |
| `start_auto_explosion` / `stop_auto_explosion` | 3 秒ごとの自動爆発 |
| `get_state` | 球数・引力点・GPU統計を取得 |

---

## 外部スクリプト

`ws://localhost:5175` に直接接続し、MCP サーバーを経由しません。  
MCP サーバーのコードが古い場合や、32点以上の引力ウェルを送る場合に使用します。

| スクリプト | 説明 |
|---|---|
| `nbody_attractors.mjs` | 10点の引力ウェルが互いに引き合う N 体シミュレーション |
| `spiral_attractors.mjs` | 引力ウェルをらせん・楕円軌道で運動させる |
| `auto_attract.mjs` | 定期的に引力場を自動設定 |
| `record_scenario.mjs` | コマンドシーケンスを JSON に録音 |
| `run_scenario.mjs` | 録音したシナリオを再生 |

```bash
node nbody_attractors.mjs
node run_scenario.mjs scenarios/bigbang_collapse.json
```

---

## アーキテクチャ

```
Claude CLI
    │ stdio
    ▼
MCP サーバー  (mcp/server.ts)
    │ WebSocket
    ▼
ブリッジ      (Vite プラグイン, ws://localhost:5175)  ◄── Node.js スクリプト
    │ WebSocket
    ▼
ブラウザ      (SimulationBridge.ts)
    │
    ├── GPUPhysicsWorld    — WGSL compute shader（積分・衝突・統計）
    └── WebGPUSceneRenderer — GPU ビルボードレンダリング・引力マーカー発光
```

### GPU params バッファレイアウト（640 bytes）

```
[0–127]   8 × vec4f  重力 / 設定 / 風 / 渦 / 壁 / 爆発
[128–639] 32 × vec4f 引力ウェル（xyz=位置, w=強度）
```

### 引力強度の目安

| 状況 | 推奨 strength |
|---|---|
| 無重力・距離 50 m | 200–500 |
| 通常重力（−9.81）・距離 50 m | 500 以上（重力に負ける） |
| 無重力・密集クラスター演出 | 50–150 |

---

## 技術スタック

| | |
|---|---|
| 物理演算 | カスタム WGSL compute shader（物理エンジンライブラリ不使用） |
| レンダリング | WebGPU（GPU モード）/ Three.js（CPU フォールバック） |
| 言語 | TypeScript |
| バンドラー | Vite |
| UI | lil-gui |
| MCP | @modelcontextprotocol/sdk |
| AI SDK | @anthropic-ai/sdk |
| テスト | Vitest |
