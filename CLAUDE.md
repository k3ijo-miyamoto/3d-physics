# CLAUDE.md

## Project Title

3D WebGPU Physics Simulation — AI-Controlled Sandbox

## 現状の概要

Three.js + TypeScript で始まったMVPから、**WebGPU compute shader ベースの大規模物理シミュレーション**に発展したプロジェクト。
Claude（MCP経由）がリアルタイムでシミュレーションを操作できる AI コントロール環境として機能している。

- 最大 **300万球** をリアルタイムシミュレーション（WebGPU）
- **MCP サーバー** 経由で Claude が直接操作可能
- WebSocket ブリッジ経由でブラウザ・MCP・外部スクリプトが協調動作

---

## Tech Stack

| カテゴリ | 技術 |
|---|---|
| レンダリング | WebGPU（direct GPU render）+ Three.js（CPUモード fallback） |
| 物理演算 | WGSL compute shader（GPU）/ カスタム実装（CPU） |
| フロントエンド | TypeScript + Vite |
| UI | lil-gui |
| MCP | @modelcontextprotocol/sdk |
| AI SDK | @anthropic-ai/sdk |
| テスト | Vitest |
| WebSocket | ws |

---

## ディレクトリ構造

```text
3d-physics/
├── CLAUDE.md
├── package.json
├── vite.config.ts          # WebSocket ブリッジプラグイン（port 5175）
├── mcp/
│   └── server.ts           # MCP サーバー（Claude CLI と接続）
├── scenarios/              # シナリオ JSON（録音・再生）
├── src/
│   ├── main.ts             # エントリポイント（HMR対応）
│   ├── app/
│   │   └── SimulationApp.ts        # アプリ統合レイヤー
│   ├── physics/
│   │   ├── PhysicsWorld.ts         # CPU物理ワールド（fallback）
│   │   ├── RigidBody.ts
│   │   ├── ForceField.ts           # 風・渦・爆発・引力フィールド
│   │   ├── AttractorBody.ts        # 引力ウェル（CPU側）
│   │   ├── CollisionDetection.ts
│   │   ├── CollisionResolution.ts
│   │   ├── CollisionManifold.ts
│   │   ├── Integrator.ts
│   │   ├── Vector3Utils.ts
│   │   ├── Octree.ts
│   │   ├── colliders/
│   │   │   ├── SphereCollider.ts
│   │   │   └── PlaneCollider.ts
│   │   └── gpu/
│   │       └── GPUPhysicsWorld.ts  # WebGPU 物理エンジン（メイン）
│   ├── rendering/
│   │   ├── WebGPUSceneRenderer.ts  # WebGPU レンダラー（GPU モード）
│   │   ├── Renderer3D.ts           # Three.js レンダラー（CPU モード）
│   │   └── ObjectFactory.ts
│   ├── simulation/
│   │   └── SimulationBridge.ts     # WebSocket ブリッジ クライアント
│   ├── ui/
│   │   ├── SimulationControls.ts   # lil-gui パネル
│   │   └── NLControlPanel.ts       # NL コントロールパネル
│   ├── ai/
│   │   └── NaturalLanguageController.ts
│   ├── logging/
│   │   └── SimulationLogger.ts
│   └── tests/
│       └── collision.test.ts
├── auto_attract.mjs        # 自動引力スクリプト
├── nbody_attractors.mjs    # N体引力シミュレーター
├── spiral_attractors.mjs   # らせん運動スクリプト
├── record_scenario.mjs     # シナリオ録音
└── run_scenario.mjs        # シナリオ再生
```

---

## コアシステム

### GPUPhysicsWorld（`src/physics/gpu/GPUPhysicsWorld.ts`）

WebGPU compute shader による物理エンジン。メインの実行パス。

**バッファレイアウト:**
- `bodyBuf`: Body 配列 `[x, y, z, radius, vx, vy, vz, inverseMass]` × maxBodies
- `paramsBuf`: 640 bytes
  - 8 × vec4f base（重力・設定・風・渦・壁・爆発）= 128 bytes
  - 32 × vec4f attractors（引力ウェル）= 512 bytes

**Params 構造体（WGSL）:**
```wgsl
struct Params {
  gravity      : vec4f,           // xyz=重力, w=dt
  config       : vec4f,           // x=damping, y=restitution, z=count
  wind         : vec4f,           // xyz=風力
  vortex       : vec4f,           // x=centerX, y=centerZ, z=tangStr, w=inwardStr
  vortexExtra  : vec4f,           // x=liftStr, y=enabled
  walls        : vec4f,           // x=halfW, y=halfD, z=enabled
  explosion    : vec4f,           // xyz=center, w=strength
  explosionMeta: vec4f,           // x=radius, y=enabled
  attractors   : array<vec4f, 32>, // xyz=position, w=strength
}
```

**シェーダーパス（step() ごと）:**
1. `INTEGRATE_WGSL` — 重力・風・渦・爆発・引力ウェル適用、床/壁衝突
2. 球同士衝突（N ≤ 512: naive O(n²)、N > 512: 空間ハッシュ O(n)）
   - `CLEAR_GRID_WGSL` → `ASSIGN_CELLS_WGSL` → `HASH_COLLIDE_WGSL`
3. `STATS_WGSL`（非同期）— 256 workgroup リダクション → avgSpeed・maxSpeed・totalKE・centerOfMass

**引力ウェル（attractors）の物理式:**
```
Δvel = (direction / dist) * (strength * dt / dist)
     = direction * strength * dt / dist²   ← 逆二乗則
```
strength=500 程度で距離50m の球を実用的に引き寄せられる。gravity=-9.81 に対抗するには `strength > |gravity| * dist` が必要。

**空間ハッシュグリッド:**
- カバー範囲: X±48m, Y 0–64m, Z±48m（セル 1m = 球径の2倍）
- グリッドサイズ: 96×64×96 = 589,824 セル
- セルあたり最大 32 球

**GPU stats readback（非同期）:**
- `statsBuf`: 8192 bytes（256 workgroup × 2 vec4f = partial sums）
- `statsParamBuf`: bodyCount を uniform で渡す
- `computeStats()`: 非同期 mapAsync → 256 ブロックを CPU で最終集計

---

### WebGPUSceneRenderer（`src/rendering/WebGPUSceneRenderer.ts`）

WebGPU レンダラー。CPU readback ゼロ。

- **球レンダリング**: `bodyBuf` を storage buffer で直接参照、6頂点 × N インスタンスのビルボード。速度でグラデーション着色。
- **床**: グリッドパターンのフラグメントシェーダー（100m × 100m）
- **引力マーカー**: `ATR_MAX=32` インスタンス、additive blending の発光ビルボード。HSV→RGB で32色を均等分配。強度0のインスタンスはクリップ座標外へ送って非表示。
- **カメラ**: マウスドラッグで方位角回転、ホイールでズーム、WASD/矢印キーで水平移動、E/Q で上下、R でリセット

**`attractorBuf` レイアウト:** 528 bytes = 32 × vec4f(16B) + 1 × vec4f timePad(16B)

---

### WebSocket ブリッジ（`vite.config.ts`）

Vite プラグインとして `ws://localhost:5175` で起動。接続中の全クライアントにメッセージをリレー（ブロードキャスト）。

```
Claude CLI
    ↕ stdio
MCP server (mcp/server.ts)
    ↕ WebSocket
Bridge (port 5175)
    ↕ WebSocket
Browser (SimulationBridge.ts)
```

外部 Node.js スクリプトも直接 `ws://localhost:5175` に接続してコマンド送信可能。

---

### MCP サーバー（`mcp/server.ts`）

`npm run mcp` または `npx tsx mcp/server.ts` で起動。**長時間プロセスのため、コード変更後は再起動が必要。**

**登録方法:**
```bash
claude mcp add physics-sim -- npx tsx /home/hacker/Project/3d-physics/mcp/server.ts
```

**利用可能なツール:**

| ツール | 説明 |
|---|---|
| `add_sphere` | 球を追加（count, height） |
| `remove_spheres` | 指定数の球を削除 |
| `remove_all_spheres` | 全球削除 |
| `reset_simulation` | リセット |
| `pause_simulation` / `resume_simulation` | 一時停止/再開 |
| `set_gravity` | 重力設定（y値） |
| `set_restitution` | 反発係数（0–1） |
| `set_damping` | 減衰（0.9–1.0） |
| `apply_wind` | 風力場（x, y, z, duration） |
| `apply_vortex` | 渦/竜巻（tangentialStr, inwardStr, liftStr, center, duration） |
| `apply_explosion` | 爆発（center, strength, radius） |
| `apply_attraction` | 単一引力場（center, strength, duration） |
| `set_attractors` | 最大32個の引力ウェルを一括設定 |
| `clear_effects` | 全フォースフィールドをクリア |
| `start_auto_explosion` / `stop_auto_explosion` | 3秒ごとの自動爆発 |
| `get_state` | 現在の状態取得（球数・引力点・GPUStats等） |

---

### フォースフィールド

| 種類 | 動作 |
|---|---|
| wind | 一定ベクトル力を全球に加える |
| vortex | 中心軸周りの回転力 + 内向き力 + 上昇力 |
| explosion | 中心から外向きの瞬間衝撃（one-shot） |
| attraction | 特定点への引力（単一） |
| attractors | 最大32点の引力ウェル（GPU uniform に直接書き込み） |

---

### シナリオシステム（`scenarios/`）

録音・再生可能なコマンドシーケンス。

```bash
# 録音
node record_scenario.mjs "scenario_name"

# 再生
node run_scenario.mjs scenarios/bigbang_collapse.json
```

JSON 形式でアクション・パラメータ・wait（ms）を記録。MCP ブリッジ経由の全コマンドが対象。

---

### 外部スクリプト（`.mjs`）

MCP サーバーを経由せず WebSocket ブリッジに直接接続して使用。

| スクリプト | 説明 |
|---|---|
| `nbody_attractors.mjs` | 10点の引力ウェルが互いに引き合うN体シミュレーション |
| `spiral_attractors.mjs` | 引力ウェルをらせん/楕円軌道で運動させる |
| `auto_attract.mjs` | 定期的に引力場を自動設定 |

MCP サーバーが5点制限で動いている場合、32点の `set_attractors` はこれらのスクリプトで直接送信する。

---

## 起動方法

```bash
# 開発サーバー（ブリッジ込み）
npm run dev

# MCP サーバー（別ターミナル）
npm run mcp

# テスト
npm test
```

ブラウザで `http://localhost:5173` を開き、「GPU モード ON」ボタンをクリックして WebGPU モードを有効化。

---

## 重要な注意事項

### MCP サーバーの再起動
コードを変更しても MCP サーバープロセスは自動的に再読み込みされない。変更後は再起動が必要:
```bash
claude mcp remove physics-sim
claude mcp add physics-sim -- npx tsx /home/hacker/Project/3d-physics/mcp/server.ts
```

### 引力強度の目安
| 状況 | 推奨 strength |
|---|---|
| 無重力（gravity=0）で距離50m | 200–500 |
| 通常重力（-9.81）で距離50m | 500以上（重力に勝てない） |
| 無重力で近距離クラスター演出 | 50–150 |

重力がある場合は `set_gravity y=0` にするか、引力ウェルの y 座標を球の高さに合わせると効果的。

### HMR とWebGPU
Vite の HMR でレンダラーモジュールが更新された場合、WebGPU デバイスリソースが再作成される。うまく反映されない場合はブラウザをハードリフレッシュ（Ctrl+Shift+R）。

### パフォーマンス
- 球数 300万でも WebGPU モードは 30–60 FPS を維持
- CPU モード（Three.js）は数千球が限界
- `fixedDt = 1/60`、フレームあたり最大2ステップ（GPU過負荷防止）

---

## 今後の拡張候補

- [ ] 収斂点を 32 → 64 スロットへ拡張（WGSL・paramsBuf の変更が必要）
- [ ] 球以外のコライダー（box、capsule）
- [ ] 回転・角速度・トルク
- [ ] 衝突グループ（レイヤーマスク）
- [ ] シナリオのブラウザUI再生プレイヤー
- [ ] CSV/グラフ形式のエネルギーログエクスポート
- [ ] WebGPU 非対応環境向けの WebGL fallback
