# Architecture — 3D WebGPU Physics Simulation

## 概要

本プロジェクトは、WebGPU compute shader を用いて最大 **300万球** をリアルタイム物理シミュレーションし、Claude（MCP 経由）が直接操作できる AI コントロール環境です。

---

## システム全体図

```
┌─────────────────────────────────────────────────────────┐
│  Claude CLI (claude コマンド)                           │
│       ↕ stdio                                           │
│  MCP Server  (mcp/server.ts)                            │
│       ↕ WebSocket                                       │
├─────────────────────────────────────────────────────────┤
│  WebSocket Bridge  (ws://localhost:5175)                 │
│  ※ Vite プラグインとして npm run dev と同時起動         │
│       ↕ WebSocket                                       │
├─────────────────────────────────────────────────────────┤
│  Browser  (http://localhost:5173)                       │
│  SimulationBridge.ts ─── SimulationApp.ts               │
│                               │                         │
│               ┌───────────────┼───────────────┐         │
│         GPUPhysicsWorld  WebGPUSceneRenderer  │         │
│         (compute shader)  (render pipeline)   │         │
│               └───────────────┴───────────────┘         │
│                      ↕ GPUBuffer (shared)                │
└─────────────────────────────────────────────────────────┘

外部スクリプト (.mjs) も直接 ws://localhost:5175 に接続可能
```

---

## レイヤー構成

### 1. 通信レイヤー

| コンポーネント | ファイル | 役割 |
|---|---|---|
| WebSocket Bridge | `vite.config.ts` | 全クライアント間メッセージリレー（ブロードキャスト）。port 5175 |
| MCP Server | `mcp/server.ts` | Claude CLI と stdio 接続し、MCP ツールを WebSocket コマンドに変換 |
| SimulationBridge | `src/simulation/SimulationBridge.ts` | ブラウザ側 WS クライアント。受信コマンドを SimulationApp のメソッドへディスパッチ |

ブリッジはメッセージを全他クライアントへそのまま転送するだけで、状態を持たない。状態問い合わせ（`get_state`）は `requestId` を使ったリクエスト/レスポンスパターンで解決する。

### 2. アプリケーションレイヤー

**`src/app/SimulationApp.ts`** — 全コンポーネントの統合点。

- **GPU モード / CPU モードの切り替え** を管理（`toggleGPU()`）
- フレームループ（`requestAnimationFrame`）を駆動
- フィジックスステップを固定 dt（1/60 s）で進める（フレームあたり最大 2 ステップ）
- `attractorBodies`（N体引力）と `spiralAttractors`（らせん運動）の CPU 側アニメーションを毎フレーム更新し、GPU uniform に書き込む

### 3. 物理レイヤー

#### GPU パス（メイン）: `src/physics/gpu/GPUPhysicsWorld.ts`

WebGPU compute shader による物理エンジン。CPU readback ゼロ。

**GPUBuffer 構成:**

| バッファ | サイズ | 内容 |
|---|---|---|
| `bodyBuf` | `maxBodies × 32 bytes` | `Body { pos: vec4f, vel: vec4f }` ― pos.w = radius, vel.w = inverseMass |
| `paramsBuf` | `1152 bytes` | `Params` struct（下記）|
| `gridCount` | `589,824 × 4 bytes` ≈ 2.3 MB | 空間ハッシュ：セルあたりの球数（`atomic<u32>`） |
| `gridBodies` | `589,824 × 32 × 4 bytes` ≈ 75 MB | 空間ハッシュ：セルの球インデックス一覧 |
| `statsBuf` | `8192 bytes` | 統計集計用パーシャルサム（256 workgroup × 8 f32） |
| `histBinBuf` | `32 × 4 bytes` | 速度ヒストグラム bin（`atomic<u32>` × 32） |

**Params struct（WGSL）:**

```wgsl
struct Params {
  gravity      : vec4f,           // xyz=重力, w=dt
  config       : vec4f,           // x=damping, y=restitution, z=count
  wind         : vec4f,           // xyz=風力
  vortex       : vec4f,           // x=centerX, y=centerZ, z=tangStr, w=inwardStr
  vortexExtra  : vec4f,           // x=liftStr, y=enabled, z=centerY, w=yConfinementStr
  walls        : vec4f,           // x=halfW, y=halfD, z=enabled
  explosion    : vec4f,           // xyz=center, w=strength
  explosionMeta: vec4f,           // x=radius, y=enabled
  attractors   : array<vec4f, 64> // xyz=position, w=strength (0=無効)
}
// 合計 = (8 + 64) × 16 bytes = 1152 bytes
```

**フレームあたりのシェーダーパス:**

```
step() ─┬─ INTEGRATE_WGSL          重力・風・渦・爆発・引力64点 / 床・壁反射
        │
        ├─ N ≤ 512: NAIVE_COLLIDE_WGSL   O(n²) 全対 衝突
        │
        └─ N > 512: 空間ハッシュ（3パス）
                ├─ CLEAR_GRID_WGSL     全セルのカウンタリセット
                ├─ ASSIGN_CELLS_WGSL   各球をセルに登録
                └─ HASH_COLLIDE_WGSL   27近傍セル参照で衝突解決

非同期（MCP get_state 時のみ）
  ├─ STATS_WGSL      → mapAsync → CPU 集計（256 workgroup パーシャルサム）
  └─ HISTOGRAM_WGSL  → mapAsync → 速度分布 32 bin
```

---

## 物理法則と数値積分

### 時間積分（半陽的オイラー法）

速度を先に更新してから位置を更新する。陽的オイラーより安定し、計算コストは同等。

```
vel += (gravity + wind) × dt        // 外力を速度に積分
vel *= damping                       // 速度減衰（乗算なのでステップ数に依存）
pos += vel × dt                      // 位置を更新
```

固定タイムステップ `dt = 1/60 s`。フレームあたり最大 2 ステップでエンコードコマンドを発行し GPU 過負荷を防ぐ。

### 衝突応答（インパルスベース）

球同士・球と床・球と壁の全てに同一の定式化を使用。

**位置補正（重なり解消）:**
```
penetration = (rA + rB) - dist(posA, posB)
posA -= normal × penetration × (invMassA / totalInvMass)
posB += normal × penetration × (invMassB / totalInvMass)
```

**速度インパルス（反発係数 e 付き）:**
```
relVel = velB - velA
vDotN  = dot(relVel, normal)
if vDotN >= 0: スキップ（離れていく方向）

j = -(1 + e) × vDotN / (invMassA + invMassB)

velA -= normal × j × invMassA
velB += normal × j × invMassB
```

`e`（restitution）= 0 で完全非弾性、= 1 で完全弾性。デフォルト 0.7。

### フォースフィールド

#### 風（Wind）
全球に一様な加速度ベクトルを加える。

```
vel += wind_xyz × dt
```

#### 渦（Vortex）
XZ 平面上の中心軸周りの回転流。接線方向・内向き・上昇力の三成分。

```
r    = pos.xz - center.xz
dist = length(r)
rNorm = r / dist

tangential : vel.xz += (-rNorm.z, rNorm.x) × tangStr × dt
inward     : vel.xz -= rNorm × r × inwardStr × dt   // 距離に比例したバネ力
lift       : vel.y  += liftStr × exp(-dist² / 2500) × dt
y-confine  : vel.y  += (centerY - pos.y) × yConfinementStr × dt
```

#### 爆発（Explosion）
一回限りのインパルス。中心からの距離に反比例した外向き速度変化。

```
d    = pos - center
dist = length(d)
if dist < radius:
  str = strength × (1 - dist/radius) × invMass / dist
  vel += d × str
```

爆発は `enabled` フラグが立っている 1 ステップだけ作用し、直後に CPU 側でフラグをリセット。

#### 引力ウェル（Attractors）
逆二乗則の点重力源。64スロット並列に GPU 内で処理。

```
d    = attractor.xyz - pos.xyz
dist = max(length(d), 1.0)      // 1m クランプで特異点回避
accel = strength × dt / dist²
vel  += (d / dist) × accel
```

`strength = 500` 程度で距離 50m の球を実用的に引き寄せられる。通常重力（−9.81）に抗うには `strength > |gravity| × dist` が必要。

### 統計量の計算（STATS_WGSL）

MCP `get_state` 呼び出し時にのみ非同期で実行。300万球を 256 workgroup × 64 スレッド = 16,384 スレッドで分担し、workgroup 内を並列リダクションで集約後、CPU 側で 256 個のパーシャルサムを最終集計。

```
KE = 0.5 × mass × |vel|²        // 運動エネルギー
PE = mass × |gravity| × pos.y   // 位置エネルギー（床面 y=0 基準）
```

---

## 空間分割（Spatial Hash Grid）

### 設計

N>512 の球同士衝突を O(n) にするための格子型空間ハッシュ。各球を均一セルに登録し、衝突判定は 27 近傍セル（3×3×3）のみ参照する。

```
グリッド範囲: X [-48, +48]m  Y [0, 64]m  Z [-48, +48]m
セルサイズ  : 1.0 m  (= 球径 0.5 m × 2 — 隣接セルで確実にカバー)
グリッドサイズ: 96 × 64 × 96 = 589,824 セル
セルあたり上限: 32 球（超過分は無視）
```

### 3パスのシェーダー実行

```
Pass 1: CLEAR_GRID
  dispatch(ceil(589824 / 64)) workgroups
  → 全セルの gridCount[cell] = 0 をアトミックにリセット

Pass 2: ASSIGN_CELLS
  dispatch(ceil(N / 64)) workgroups
  → 各球について (cx, cy, cz) → cell インデックスを計算
  → atomicAdd(&gridCount[cell], 1) でカウント & スロット取得
  → gridBodies[cell × 32 + slot] = i に球インデックスを書き込む

Pass 3: HASH_COLLIDE
  dispatch(ceil(N / 64)) workgroups
  → 各球の所属セルを計算し、27近傍を走査
  → 各近傍セルの球と衝突判定・インパルス解決（NAIVE_COLLIDE と同じ定式化）
```

### 計算量

| 球数 | パス | 計算量 |
|---|---|---|
| ≤ 512 | NAIVE_COLLIDE | O(n²) |
| > 512 | CLEAR + ASSIGN + HASH_COLLIDE | O(n)（セルあたり球数が定数の場合） |
| 300万 | HASH_COLLIDE のみ | ~27 × 32 = 864 比較/球 = O(n) |

### グリッド範囲外の球

ASSIGN_CELLS でグリッド外の球はスキップされ、gridBodies に登録されない。HASH_COLLIDE でも 27近傍がグリッド境界外のセルは参照されないため、フェンス処理は境界チェックのみ。

---

## 計算性能の設計指針

### workgroup サイズ

全シェーダーで `@workgroup_size(64)` を採用。NVIDIA/AMD/Intel の一般的な warp/wavefront サイズ（32–64 スレッド）に合わせており、SIMD 効率を最大化する。

### GPU ↔ CPU データ転送の最小化

| 操作 | 転送方向 | 頻度 |
|---|---|---|
| paramsBuf 更新（引力・重力など） | CPU → GPU | 毎フレーム、`writeBuffer`（非同期） |
| bodyBuf（球の位置・速度） | GPU 内のみ | レンダラーも @storage で直読み |
| statsBuf 集計 | GPU → CPU | MCP `get_state` 時のみ（`mapAsync`） |

bodyBuf は WebGPU storage buffer として compute/render の両パイプラインが直接参照するため、CPU readback は発生しない。

### エンコーダーのバッチ処理

1フレームの `step()` 呼び出しで、全シェーダーディスパッチを **1つの GPUCommandEncoder** にまとめて `submit()` する。これにより GPU キューへのオーバーヘッドが最小になる。

```
encoder = device.createCommandEncoder()
encoder.computePass → INTEGRATE dispatch
encoder.computePass → NAIVE/HASH dispatch(es)
device.queue.submit([encoder.finish()])
```

### スケーラビリティの実測値

| 球数 | モード | 典型 FPS |
|---|---|---|
| 数千 | CPU (Three.js) | 30–60 FPS |
| 10万 | GPU | 60 FPS |
| 100万 | GPU | 30–60 FPS |
| 300万 | GPU | 30–60 FPS |

#### CPU パス（フォールバック）

| ファイル | 役割 |
|---|---|
| `src/physics/PhysicsWorld.ts` | RigidBody 管理・固定 dt ループ |
| `src/physics/Integrator.ts` | 半陽的オイラー積分（GPU と同一の定式化） |
| `src/physics/CollisionDetection.ts` | 球・平面判定 |
| `src/physics/CollisionResolution.ts` | インパルスベースの衝突解決（GPU と同一の定式化） |
| `src/physics/Octree.ts` | 広域フェーズの Octree（CPU 空間分割） |
| `src/physics/ForceField.ts` | 風・渦・爆発・引力フィールド |
| `src/physics/AttractorBody.ts` | N体引力ウェル（CPU 側速度を持つ点質量） |

### 4. レンダリングレイヤー

#### GPU レンダラー: `src/rendering/WebGPUSceneRenderer.ts`

- `bodyBuf` を `@storage` で直接参照（CPU readback なし）
- 6頂点 × N インスタンスのビルボードで球を描画（速度でグラデーション着色）
- 引力マーカー: `attractorBuf` 528 bytes（32 × vec4f + timePad）、HSV で 32 色均等分配、additive blending
- 床: グリッドパターンのフラグメントシェーダー（100m × 100m）

#### CPU レンダラー: `src/rendering/Renderer3D.ts`

- Three.js ベース。CPU モード時のみ使用
- GPU モード切替時は `display:none` で非表示

### 5. UI レイヤー

| コンポーネント | ファイル | 役割 |
|---|---|---|
| SimulationControls | `src/ui/SimulationControls.ts` | lil-gui パネル（重力・反発係数・減衰等） |
| NLControlPanel | `src/ui/NLControlPanel.ts` | 自然言語コントロールパネル / MCP 接続インジケータ |

### 6. ロギング・シナリオ

| コンポーネント | ファイル | 役割 |
|---|---|---|
| SimulationLogger | `src/logging/SimulationLogger.ts` | CPU モードでの物理量ログ・CSV エクスポート |
| run_scenario.mjs | `run_scenario.mjs` | シナリオ JSON を WS ブリッジ経由で再生 |
| record_scenario.mjs | `record_scenario.mjs` | WS 上のコマンドを JSON に録音 |

---

## データフロー（GPU モード・フレームごと）

```
requestAnimationFrame
  │
  ├─ CPU: attractorBodies を stepAttractorBodies() で更新（N体引力）
  ├─ CPU: spiralAttractors を三角関数で更新（らせん運動）
  ├─ CPU: gpuWorld.attractors[64] に書き込み
  │
  ├─ gpuWorld.step(fixedDt)
  │     ├─ paramsBuf を writeBuffer で更新（引力含む全パラメータ）
  │     ├─ INTEGRATE shader dispatch
  │     └─ Collision shader dispatch（N に応じて naive / spatial hash 切替）
  │
  └─ gpuSceneRenderer.render(count)
        ├─ bodyBuf を @storage で直接参照（readback なし）
        └─ draw(6 × count)  ← ビルボードインスタンシング
```

---

## 外部スクリプト

WS ブリッジに直接接続し、MCP を介さず操作する Node.js スクリプト群。32スロット `set_attractors` 等、MCP の制限を回避する用途。

| スクリプト | 説明 |
|---|---|
| `nbody_attractors.mjs` | 引力ウェルが互いに引き合うN体シミュレーション |
| `spiral_attractors.mjs` | 引力ウェルをらせん/楕円軌道で周回 |
| `auto_attract.mjs` | 定期的に引力場を自動設定 |

---

## 起動・接続フロー

```
1. npm run dev          → Vite dev server + WS bridge (port 5175) 起動
2. ブラウザで localhost:5173 を開く
3. 「GPU モード ON」ボタン → WebGPU デバイス取得・バッファ確保
4. (別ターミナル) npm run mcp → MCP server が bridge に接続
5. Claude CLI から mcp__physics-sim__* ツールを呼び出すと
   → MCP server → bridge → SimulationBridge → SimulationApp と伝搬
```

---

## 主要な設計上の決定

| 決定 | 理由 |
|---|---|
| CPU readback ゼロ | 300万球規模では GPU→CPU 転送が主要ボトルネックになるため |
| 空間ハッシュ（N>512） | O(n²)の naive 衝突は ~512球超で破綻するため |
| 固定 dt（1/60s）× 最大2ステップ | GPU 過負荷防止と物理安定性のトレードオフ |
| WS ブリッジをブロードキャスト | MCP・外部スクリプト・ブラウザを疎結合に接続するため |
| 引力 64スロット（GPU uniform） | 512bytes アライメントで WGSL uniform に収まる最大数 |
