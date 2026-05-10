// Body layout in GPU buffer: [x, y, z, radius, vx, vy, vz, inverseMass]
const FLOATS_PER_BODY = 8;

// ---------------------------------------------------------------------------
// Spatial hash grid constants
// Covers X: ±32m, Y: 0–48m, Z: ±32m  (cell = 1m = 2×radius)
// ---------------------------------------------------------------------------
const GRID_W = 96;
const GRID_H = 64;
const GRID_D = 96;
const GRID_OX = 48;   // world-space offset → grid index
const GRID_OZ = 48;
const CELL_SIZE = 1.0; // = 2 × sphere radius 0.5
const MAX_PER_CELL = 32;
const GRID_TOTAL = GRID_W * GRID_H * GRID_D; // 196 608 cells
const GRID_WH = GRID_W * GRID_H;

// Switch to spatial hash above this count (below: naive O(n²) is cheaper)
const NAIVE_THRESHOLD = 512;

// ---------------------------------------------------------------------------
// Shared Params struct (embedded in every shader that needs it)
// ---------------------------------------------------------------------------
const PARAMS_STRUCT = /* wgsl */`
struct Params {
  gravity      : vec4f,          // xyz = gravity, w = dt
  config       : vec4f,          // x = damping, y = restitution, z = count(f32), w = unused
  wind         : vec4f,          // xyz = wind, w = unused
  vortex       : vec4f,          // x = centerX, y = centerZ, z = tangentialStr, w = inwardStr
  vortexExtra  : vec4f,          // x = liftStr, y = enabled(1/0), zw = unused
  walls        : vec4f,          // x = halfW, y = halfD, z = enabled(1/0), w = unused
  explosion    : vec4f,          // xyz = center, w = strength
  explosionMeta: vec4f,          // x = radius, y = enabled(1/0), zw = unused
  attractors   : array<vec4f, 64>, // xyz = position, w = strength (0 = disabled)
}
`;

// ---------------------------------------------------------------------------
// WGSL: Integration + force fields + floor/wall/explosion collision
// ---------------------------------------------------------------------------
const INTEGRATE_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(params.config.z)) { return; }
  var b = bodies[i];
  let invM = b.vel.w;
  if (invM == 0.0) { return; }

  let dt   = params.gravity.w;
  let damp = params.config.x;
  let rest = params.config.y;

  // Gravity + wind
  b.vel.x += (params.gravity.x + params.wind.x) * dt;
  b.vel.y += (params.gravity.y + params.wind.y) * dt;
  b.vel.z += (params.gravity.z + params.wind.z) * dt;

  // Vortex: tangent = cross(rNorm, UP) = (-rnz, 0, rnx)
  if (params.vortexExtra.y > 0.0) {
    let rx = b.pos.x - params.vortex.x;
    let rz = b.pos.z - params.vortex.y;
    let d2 = rx*rx + rz*rz;
    if (d2 > 0.0025) {
      let dist = sqrt(d2);
      let rnx = rx / dist; let rnz = rz / dist;
      // tangential: constant magnitude; inward: spring force (proportional to distance)
      b.vel.x += (-rnz * params.vortex.z - rx * params.vortex.w) * dt;
      b.vel.z += ( rnx * params.vortex.z - rz * params.vortex.w) * dt;
      b.vel.y += params.vortexExtra.x * exp(-d2 / 2500.0) * dt;
    }
    // Y-axis confinement: pull toward centerY (vortexExtra.z) with strength (vortexExtra.w)
    b.vel.y += (params.vortexExtra.z - b.pos.y) * params.vortexExtra.w * dt;
  }

  // Damping
  b.vel.x *= damp; b.vel.y *= damp; b.vel.z *= damp;

  // Integrate
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;

  // Floor
  let r = b.pos.w;
  if (b.pos.y < r) { b.pos.y = r; if (b.vel.y < 0.0) { b.vel.y = -b.vel.y * rest; } }

  // Explosion (one-shot)
  if (params.explosionMeta.y > 0.0) {
    let ex = b.pos.x - params.explosion.x;
    let ey = b.pos.y - params.explosion.y;
    let ez = b.pos.z - params.explosion.z;
    let dist = sqrt(ex*ex + ey*ey + ez*ez);
    if (dist > 0.05 && dist < params.explosionMeta.x) {
      let str = params.explosion.w * (1.0 - dist / params.explosionMeta.x) * invM / dist;
      b.vel.x += ex * str; b.vel.y += ey * str; b.vel.z += ez * str;
    }
  }

  // Attractors (up to 32 gravity wells)
  for (var ai = 0u; ai < 64u; ai++) {
    let atr = params.attractors[ai];
    if (atr.w == 0.0) { continue; }
    let d    = atr.xyz - b.pos.xyz;
    let dist = max(sqrt(dot(d, d)), 1.0);  // clamp at 1m to avoid singularity
    let accel = atr.w * dt / (dist * dist);  // magnitude: strength/r²
    b.vel.x += (d.x / dist) * accel;
    b.vel.y += (d.y / dist) * accel;
    b.vel.z += (d.z / dist) * accel;
  }

  // Walls (AABB)
  if (params.walls.z > 0.0) {
    let hw = params.walls.x; let hd = params.walls.y;
    if (b.pos.x >  hw-r) { b.pos.x =  hw-r; if (b.vel.x > 0.0) { b.vel.x = -b.vel.x * rest; } }
    if (b.pos.x < -hw+r) { b.pos.x = -hw+r; if (b.vel.x < 0.0) { b.vel.x = -b.vel.x * rest; } }
    if (b.pos.z >  hd-r) { b.pos.z =  hd-r; if (b.vel.z > 0.0) { b.vel.z = -b.vel.z * rest; } }
    if (b.pos.z < -hd+r) { b.pos.z = -hd+r; if (b.vel.z < 0.0) { b.vel.z = -b.vel.z * rest; } }
  }

  bodies[i] = b;
}
`;

// ---------------------------------------------------------------------------
// WGSL: Naive O(n²) sphere-sphere collision (used when N ≤ NAIVE_THRESHOLD)
// ---------------------------------------------------------------------------
const NAIVE_COLLIDE_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
struct Params { gravity:vec4f, config:vec4f, wind:vec4f }
@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let count = u32(params.config.z);
  if (i >= count) { return; }
  var a = bodies[i];
  if (a.vel.w == 0.0) { return; }
  let rest = params.config.y;
  for (var j = 0u; j < count; j++) {
    if (j == i) { continue; }
    let b = bodies[j];
    let d = b.pos.xyz - a.pos.xyz;
    let d2 = dot(d, d);
    let minD = a.pos.w + b.pos.w;
    if (d2 >= minD*minD || d2 < 0.00001) { continue; }
    let dist = sqrt(d2);
    let n = d / dist;
    let pen = minD - dist;
    let tInvM = a.vel.w + b.vel.w;
    if (tInvM == 0.0) { continue; }
    a.pos = vec4f(a.pos.xyz - n * (pen * (a.vel.w / tInvM)), a.pos.w);
    let vDotN = dot(b.vel.xyz - a.vel.xyz, n);
    if (vDotN < 0.0) {
      let imp = -(1.0 + rest) * vDotN / tInvM;
      a.vel = vec4f(a.vel.xyz - n * (imp * a.vel.w), a.vel.w);
    }
  }
  bodies[i] = a;
}
`;

// ---------------------------------------------------------------------------
// WGSL: Spatial hash — Pass 1: clear grid counters
// ---------------------------------------------------------------------------
const CLEAR_GRID_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> gridCount: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${GRID_TOTAL}u) { return; }
  atomicStore(&gridCount[gid.x], 0u);
}
`;

// ---------------------------------------------------------------------------
// WGSL: Spatial hash — Pass 2: assign bodies to cells
// ---------------------------------------------------------------------------
const ASSIGN_CELLS_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
struct Params { gravity:vec4f, config:vec4f, wind:vec4f }
@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<uniform> params: Params;
@group(1) @binding(0) var<storage, read_write> gridCount: array<atomic<u32>>;
@group(1) @binding(1) var<storage, read_write> gridBodies: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(params.config.z)) { return; }
  let b = bodies[i];
  let cx = i32(floor(b.pos.x / ${CELL_SIZE}f)) + ${GRID_OX};
  let cy = i32(floor(b.pos.y / ${CELL_SIZE}f));
  let cz = i32(floor(b.pos.z / ${CELL_SIZE}f)) + ${GRID_OZ};
  if (cx < 0 || cx >= ${GRID_W} || cy < 0 || cy >= ${GRID_H} || cz < 0 || cz >= ${GRID_D}) { return; }
  let cell = u32(cx + cy * ${GRID_W} + cz * ${GRID_WH});
  let slot = atomicAdd(&gridCount[cell], 1u);
  if (slot < ${MAX_PER_CELL}u) {
    gridBodies[cell * ${MAX_PER_CELL}u + slot] = i;
  }
}
`;

// ---------------------------------------------------------------------------
// WGSL: Spatial hash — Pass 3: collide using grid (27-neighbor lookup)
// ---------------------------------------------------------------------------
const HASH_COLLIDE_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
struct Params { gravity:vec4f, config:vec4f, wind:vec4f }
@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<uniform> params: Params;
@group(1) @binding(0) var<storage, read_write> gridCount: array<atomic<u32>>;
@group(1) @binding(1) var<storage, read_write> gridBodies: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(params.config.z)) { return; }
  var a = bodies[i];
  if (a.vel.w == 0.0) { return; }
  let rest = params.config.y;

  let cx = i32(floor(a.pos.x / ${CELL_SIZE}f)) + ${GRID_OX};
  let cy = i32(floor(a.pos.y / ${CELL_SIZE}f));
  let cz = i32(floor(a.pos.z / ${CELL_SIZE}f)) + ${GRID_OZ};

  for (var dx = -1i; dx <= 1i; dx++) {
    for (var dy = -1i; dy <= 1i; dy++) {
      for (var dz = -1i; dz <= 1i; dz++) {
        let nx = cx + dx; let ny = cy + dy; let nz = cz + dz;
        if (nx < 0 || nx >= ${GRID_W} || ny < 0 || ny >= ${GRID_H} || nz < 0 || nz >= ${GRID_D}) { continue; }
        let cell = u32(nx + ny * ${GRID_W} + nz * ${GRID_WH});
        let cellN = min(atomicLoad(&gridCount[cell]), ${MAX_PER_CELL}u);
        for (var k = 0u; k < cellN; k++) {
          let j = gridBodies[cell * ${MAX_PER_CELL}u + k];
          if (j == i) { continue; }
          let b = bodies[j];
          let d = b.pos.xyz - a.pos.xyz;
          let d2 = dot(d, d);
          let minD = a.pos.w + b.pos.w;
          if (d2 >= minD*minD || d2 < 0.00001) { continue; }
          let dist = sqrt(d2);
          let n = d / dist;
          let pen = minD - dist;
          let tInvM = a.vel.w + b.vel.w;
          if (tInvM == 0.0) { continue; }
          a.pos = vec4f(a.pos.xyz - n * (pen * (a.vel.w / tInvM)), a.pos.w);
          let vDotN = dot(b.vel.xyz - a.vel.xyz, n);
          if (vDotN < 0.0) {
            let imp = -(1.0 + rest) * vDotN / tInvM;
            a.vel = vec4f(a.vel.xyz - n * (imp * a.vel.w), a.vel.w);
          }
        }
      }
    }
  }
  bodies[i] = a;
}
`;

// ---------------------------------------------------------------------------
// WGSL: Stats reduction — computes per-workgroup partial stats,
//       then CPU sums 256 partials. Called only on demand (MCP get_state).
// ---------------------------------------------------------------------------
const STATS_WG = 256; // workgroup count — 256×64 = 16384 threads cover 3M bodies in ~183 iters each
const STATS_BYTES = STATS_WG * 8 * 4; // 8 f32 per workgroup × 256 × 4 bytes = 8192 bytes

const STATS_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
struct WGStats { sumSpeed: f32, maxSpeed: f32, sumKE: f32, sumPx: f32, sumPy: f32, sumPz: f32, count: f32, _pad: f32 }

@group(0) @binding(0) var<storage, read>       bodies  : array<Body>;
@group(0) @binding(1) var<storage, read_write> statsOut: array<WGStats>;
@group(0) @binding(2) var<uniform>             countVec: vec4u;

var<workgroup> wgSpeed: array<f32, 64>;
var<workgroup> wgMaxSp: array<f32, 64>;
var<workgroup> wgKE   : array<f32, 64>;
var<workgroup> wgPx   : array<f32, 64>;
var<workgroup> wgPy   : array<f32, 64>;
var<workgroup> wgPz   : array<f32, 64>;
var<workgroup> wgCnt  : array<f32, 64>;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id)  lid: vec3u,
  @builtin(workgroup_id)         wid: vec3u,
) {
  let tid    = lid.x;
  let N      = countVec.x;
  let stride = ${STATS_WG}u * 64u;

  var sp = 0.0; var mx = 0.0; var ke = 0.0;
  var px = 0.0; var py = 0.0; var pz = 0.0; var cnt = 0.0;

  var i = gid.x;
  while (i < N) {
    let b    = bodies[i];
    let invM = b.vel.w;
    if (invM > 0.0) {
      let v2 = dot(b.vel.xyz, b.vel.xyz);
      let s  = sqrt(v2);
      sp  += s;
      mx   = max(mx, s);
      ke  += 0.5 * v2 / invM;  // 0.5 * mass * v²
      px  += b.pos.x;
      py  += b.pos.y;
      pz  += b.pos.z;
      cnt += 1.0;
    }
    i += stride;
  }

  wgSpeed[tid] = sp; wgMaxSp[tid] = mx; wgKE[tid] = ke;
  wgPx[tid] = px; wgPy[tid] = py; wgPz[tid] = pz; wgCnt[tid] = cnt;
  workgroupBarrier();

  for (var s = 32u; s > 0u; s >>= 1u) {
    if (tid < s) {
      wgSpeed[tid] += wgSpeed[tid + s];
      wgMaxSp[tid]  = max(wgMaxSp[tid], wgMaxSp[tid + s]);
      wgKE[tid]    += wgKE[tid + s];
      wgPx[tid]    += wgPx[tid + s];
      wgPy[tid]    += wgPy[tid + s];
      wgPz[tid]    += wgPz[tid + s];
      wgCnt[tid]   += wgCnt[tid + s];
    }
    workgroupBarrier();
  }

  if (tid == 0u) {
    var out: WGStats;
    out.sumSpeed = wgSpeed[0]; out.maxSpeed = wgMaxSp[0]; out.sumKE = wgKE[0];
    out.sumPx = wgPx[0]; out.sumPy = wgPy[0]; out.sumPz = wgPz[0];
    out.count = wgCnt[0]; out._pad = 0.0;
    statsOut[wid.x] = out;
  }
}
`;

// ---------------------------------------------------------------------------
// WGSL: Set all bodies' radius in one pass
// ---------------------------------------------------------------------------
const SET_RADIUS_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<uniform> p: vec4f; // x = count(f32), y = new radius

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (f32(gid.x) >= p.x) { return; }
  bodies[gid.x].pos.w = p.y;
}
`;

// ---------------------------------------------------------------------------
// GPUPhysicsWorld
// ---------------------------------------------------------------------------

export class GPUPhysicsWorld {
  private device: GPUDevice;

  // Body data
  private bodyBuf: GPUBuffer;
  private paramsBuf: GPUBuffer;
  private readBuf: GPUBuffer;

  // Spatial hash buffers
  private gridCountBuf: GPUBuffer;
  private gridBodiesBuf: GPUBuffer;

  // Bind group layouts
  private bgl0: GPUBindGroupLayout; // bodies + params
  private bgl1: GPUBindGroupLayout; // gridCount + gridBodies

  // Pipelines
  private integratePipe: GPUComputePipeline;
  private naiveCollidePipe: GPUComputePipeline;
  private clearGridPipe: GPUComputePipeline;
  private assignCellsPipe: GPUComputePipeline;
  private hashCollidePipe: GPUComputePipeline;
  private setRadiusPipe: GPUComputePipeline;

  // Bind groups
  private bg0: GPUBindGroup;  // bodies + params
  private bg1: GPUBindGroup;  // grid buffers
  private setRadiusBG: GPUBindGroup;
  private setRadiusParamBuf: GPUBuffer;

  // Stats reduction (on-demand, for MCP get_state)
  private statsPipe: GPUComputePipeline;
  private statsBuf: GPUBuffer;
  private statsReadBuf: GPUBuffer;
  private statsParamBuf: GPUBuffer;
  private statsBG: GPUBindGroup;

  readonly maxBodies: number;
  count = 0;

  gravity = { x: 0, y: -9.81, z: 0 };
  restitution = 0.7;
  damping = 0.995;
  wind = { x: 0, y: 0, z: 0 };
  vortex = { centerX: 0, centerZ: 0, tangentialStrength: 0, inwardStrength: 0, liftStrength: 0, centerY: 30, yConfinementStr: 0, enabled: false };
  walls = { halfWidth: 10, halfDepth: 10, enabled: false };
  explosion = { x: 0, y: 0, z: 0, strength: 0, radius: 0, enabled: false };
  attractors: Array<{ x: number; y: number; z: number; strength: number }> = Array.from(
    { length: 64 }, () => ({ x: 0, y: 0, z: 0, strength: 0 }),
  );
  fixedDt = 1 / 60;

  private constructor(device: GPUDevice, maxBodies: number) {
    this.device = device;
    this.maxBodies = maxBodies;
    const bodiesByteSize = maxBodies * FLOATS_PER_BODY * 4;

    // Body / params / readback buffers
    this.bodyBuf = device.createBuffer({
      size: bodiesByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuf = device.createBuffer({
      size: 1152, // 8 × vec4f base + 64 × vec4f attractors = 1152 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.readBuf = device.createBuffer({
      size: bodiesByteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Spatial hash grid buffers
    this.gridCountBuf = device.createBuffer({
      size: GRID_TOTAL * 4,                    // atomic<u32> per cell — 288 KB
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gridBodiesBuf = device.createBuffer({
      size: GRID_TOTAL * MAX_PER_CELL * 4,     // body indices — 4.7 MB
      usage: GPUBufferUsage.STORAGE,
    });

    // Bind group layouts
    this.bgl0 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.bgl1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // Pipeline layouts
    const layout0 = device.createPipelineLayout({ bindGroupLayouts: [this.bgl0] });
    const layout01 = device.createPipelineLayout({ bindGroupLayouts: [this.bgl0, this.bgl1] });
    const layoutGrid = device.createPipelineLayout({ bindGroupLayouts: [this.bgl1] });

    const shader = (code: string) => device.createShaderModule({ code });

    this.integratePipe = device.createComputePipeline({
      layout: layout0,
      compute: { module: shader(INTEGRATE_WGSL), entryPoint: 'main' },
    });
    this.naiveCollidePipe = device.createComputePipeline({
      layout: layout0,
      compute: { module: shader(NAIVE_COLLIDE_WGSL), entryPoint: 'main' },
    });
    this.clearGridPipe = device.createComputePipeline({
      layout: layoutGrid,
      compute: { module: shader(CLEAR_GRID_WGSL), entryPoint: 'main' },
    });
    this.assignCellsPipe = device.createComputePipeline({
      layout: layout01,
      compute: { module: shader(ASSIGN_CELLS_WGSL), entryPoint: 'main' },
    });
    this.hashCollidePipe = device.createComputePipeline({
      layout: layout01,
      compute: { module: shader(HASH_COLLIDE_WGSL), entryPoint: 'main' },
    });

    // Bind groups
    this.bg0 = device.createBindGroup({
      layout: this.bgl0,
      entries: [
        { binding: 0, resource: { buffer: this.bodyBuf } },
        { binding: 1, resource: { buffer: this.paramsBuf } },
      ],
    });
    this.bg1 = device.createBindGroup({
      layout: this.bgl1,
      entries: [
        { binding: 0, resource: { buffer: this.gridCountBuf } },
        { binding: 1, resource: { buffer: this.gridBodiesBuf } },
      ],
    });

    // setAllRadii pipeline
    const setRadiusBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]});
    this.setRadiusPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [setRadiusBGL] }),
      compute: { module: shader(SET_RADIUS_WGSL), entryPoint: 'main' },
    });
    this.setRadiusParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.setRadiusBG = device.createBindGroup({ layout: setRadiusBGL, entries: [
      { binding: 0, resource: { buffer: this.bodyBuf } },
      { binding: 1, resource: { buffer: this.setRadiusParamBuf } },
    ]});

    // Stats reduction pipeline
    this.statsBuf = device.createBuffer({
      size: STATS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.statsReadBuf = device.createBuffer({
      size: STATS_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.statsParamBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const statsBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]});
    this.statsPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [statsBGL] }),
      compute: { module: shader(STATS_WGSL), entryPoint: 'main' },
    });
    this.statsBG = device.createBindGroup({ layout: statsBGL, entries: [
      { binding: 0, resource: { buffer: this.bodyBuf } },
      { binding: 1, resource: { buffer: this.statsBuf } },
      { binding: 2, resource: { buffer: this.statsParamBuf } },
    ]});
  }

  static async create(maxBodies = 20000): Promise<GPUPhysicsWorld> {
    if (!navigator.gpu) throw new Error('WebGPU がこのブラウザでサポートされていません (Chrome 113+ が必要)');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU アダプターが利用できません');
    const device = await adapter.requestDevice();
    return new GPUPhysicsWorld(device, maxBodies);
  }

  addBody(x: number, y: number, z: number, r: number, mass: number,
          vx = 0, vy = 0, vz = 0): void {
    if (this.count >= this.maxBodies) return;
    const tmp = new Float32Array([x, y, z, r, vx, vy, vz, mass > 0 ? 1 / mass : 0]);
    this.device.queue.writeBuffer(this.bodyBuf, this.count * FLOATS_PER_BODY * 4, tmp);
    this.count++;
  }

  // Spawn N bodies in a single GPU write — far more efficient than N addBody() calls
  addBodiesBulk(
    n: number, r: number, mass: number,
    spread: number, minY: number, maxY: number,
    vSpread = 0,
  ): void {
    const actual = Math.min(n, this.maxBodies - this.count);
    if (actual <= 0) return;
    const invM = mass > 0 ? 1 / mass : 0;
    const data = new Float32Array(actual * FLOATS_PER_BODY);
    for (let i = 0; i < actual; i++) {
      const o = i * FLOATS_PER_BODY;
      data[o]   = (Math.random() - 0.5) * spread;
      data[o+1] = minY + Math.random() * (maxY - minY);
      data[o+2] = (Math.random() - 0.5) * spread;
      data[o+3] = r;
      data[o+4] = (Math.random() - 0.5) * vSpread;
      data[o+5] = (Math.random() - 0.5) * vSpread;
      data[o+6] = (Math.random() - 0.5) * vSpread;
      data[o+7] = invM;
    }
    this.device.queue.writeBuffer(this.bodyBuf, this.count * FLOATS_PER_BODY * 4, data);
    this.count += actual;
  }

  addBodiesShell(n: number, r: number, mass: number, shellRadius: number, thickness: number): void {
    const actual = Math.min(n, this.maxBodies - this.count);
    if (actual <= 0) return;
    const invM = mass > 0 ? 1 / mass : 0;
    const data = new Float32Array(actual * FLOATS_PER_BODY);
    for (let i = 0; i < actual; i++) {
      const o = i * FLOATS_PER_BODY;
      // uniform point on sphere surface via normal distribution
      const nx = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      const ny = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      const nz = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      const rad = shellRadius + (Math.random() - 0.5) * thickness;
      data[o]   = (nx / len) * rad;
      data[o+1] = Math.max(r, (ny / len) * rad + shellRadius); // keep above floor
      data[o+2] = (nz / len) * rad;
      data[o+3] = r;
      data[o+4] = 0; data[o+5] = 0; data[o+6] = 0;
      data[o+7] = invM;
    }
    this.device.queue.writeBuffer(this.bodyBuf, this.count * FLOATS_PER_BODY * 4, data);
    this.count += actual;
  }

  setAllRadii(r: number): void {
    if (this.count === 0) return;
    this.device.queue.writeBuffer(this.setRadiusParamBuf, 0, new Float32Array([this.count, r, 0, 0]));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.setRadiusPipe);
    pass.setBindGroup(0, this.setRadiusBG);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  removeAll(): void {
    this.count = 0;
  }

  removeSpheres(n: number): void {
    this.count = Math.max(0, this.count - n);
  }

  step(dt: number): void {
    if (this.count === 0) return;

    // Write params: 8 × vec4f base (128 bytes) + 64 × vec4f attractors (1024 bytes) = 1152 bytes
    const p = new Float32Array(160);
    p[0] = this.gravity.x; p[1] = this.gravity.y; p[2] = this.gravity.z; p[3] = dt;
    p[4] = this.damping;   p[5] = this.restitution; p[6] = this.count;   p[7] = 0;
    p[8] = this.wind.x;    p[9] = this.wind.y;    p[10] = this.wind.z;  p[11] = 0;
    p[12] = this.vortex.centerX;           p[13] = this.vortex.centerZ;
    p[14] = this.vortex.tangentialStrength; p[15] = this.vortex.inwardStrength;
    p[16] = this.vortex.liftStrength; p[17] = this.vortex.enabled ? 1 : 0; p[18] = this.vortex.centerY; p[19] = this.vortex.yConfinementStr;
    p[20] = this.walls.halfWidth; p[21] = this.walls.halfDepth;
    p[22] = this.walls.enabled ? 1 : 0; p[23] = 0;
    p[24] = this.explosion.x; p[25] = this.explosion.y; p[26] = this.explosion.z; p[27] = this.explosion.strength;
    p[28] = this.explosion.radius; p[29] = this.explosion.enabled ? 1 : 0; p[30] = 0; p[31] = 0;
    for (let i = 0; i < 64; i++) {
      const a = this.attractors[i];
      p[32 + i * 4] = a.x; p[33 + i * 4] = a.y; p[34 + i * 4] = a.z; p[35 + i * 4] = a.strength;
    }
    this.device.queue.writeBuffer(this.paramsBuf, 0, p);

    if (this.explosion.enabled) this.explosion.enabled = false;

    const wg = Math.ceil(this.count / 64);
    const enc = this.device.createCommandEncoder();

    if (this.count <= NAIVE_THRESHOLD) {
      // Naive O(n²) — accurate for small N
      const pass = enc.beginComputePass();
      pass.setPipeline(this.naiveCollidePipe);
      pass.setBindGroup(0, this.bg0);
      pass.dispatchWorkgroups(wg);
      pass.end();
    } else {
      // Spatial hash: 3-pass O(n) collision
      // Pass 1: clear grid
      {
        const pass = enc.beginComputePass();
        pass.setPipeline(this.clearGridPipe);
        pass.setBindGroup(0, this.bg1);
        pass.dispatchWorkgroups(Math.ceil(GRID_TOTAL / 64));
        pass.end();
      }
      // Pass 2: assign bodies to cells
      {
        const pass = enc.beginComputePass();
        pass.setPipeline(this.assignCellsPipe);
        pass.setBindGroup(0, this.bg0);
        pass.setBindGroup(1, this.bg1);
        pass.dispatchWorkgroups(wg);
        pass.end();
      }
      // Pass 3: collide using 27-neighbor grid lookup
      {
        const pass = enc.beginComputePass();
        pass.setPipeline(this.hashCollidePipe);
        pass.setBindGroup(0, this.bg0);
        pass.setBindGroup(1, this.bg1);
        pass.dispatchWorkgroups(wg);
        pass.end();
      }
    }

    // Integration + force fields + floor/wall/explosion
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.integratePipe);
      pass.setBindGroup(0, this.bg0);
      pass.dispatchWorkgroups(wg);
      pass.end();
    }

    this.device.queue.submit([enc.finish()]);
  }

  get gpuDevice(): GPUDevice { return this.device; }
  get bodyBuffer(): GPUBuffer { return this.bodyBuf; }

  async computeStats(): Promise<{
    count: number; avgSpeed: number; maxSpeed: number;
    totalKE: number; centerOfMass: [number, number, number];
  }> {
    if (this.count === 0) return { count: 0, avgSpeed: 0, maxSpeed: 0, totalKE: 0, centerOfMass: [0, 0, 0] };

    this.device.queue.writeBuffer(this.statsParamBuf, 0, new Uint32Array([this.count, 0, 0, 0]));

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.statsPipe);
    pass.setBindGroup(0, this.statsBG);
    pass.dispatchWorkgroups(STATS_WG);
    pass.end();
    enc.copyBufferToBuffer(this.statsBuf, 0, this.statsReadBuf, 0, STATS_BYTES);
    this.device.queue.submit([enc.finish()]);

    await this.statsReadBuf.mapAsync(GPUMapMode.READ, 0, STATS_BYTES);
    const data = new Float32Array(this.statsReadBuf.getMappedRange(0, STATS_BYTES).slice(0));
    this.statsReadBuf.unmap();

    // Reduce 256 workgroup partials on CPU
    let sumSpeed = 0, maxSpeed = 0, sumKE = 0, sumPx = 0, sumPy = 0, sumPz = 0, count = 0;
    for (let i = 0; i < STATS_WG; i++) {
      const b = i * 8;
      sumSpeed += data[b + 0];
      maxSpeed  = Math.max(maxSpeed, data[b + 1]);
      sumKE    += data[b + 2];
      sumPx    += data[b + 3];
      sumPy    += data[b + 4];
      sumPz    += data[b + 5];
      count    += data[b + 6];
    }
    const n = count || 1;
    return {
      count: this.count,
      avgSpeed: +(sumSpeed / n).toFixed(3),
      maxSpeed: +maxSpeed.toFixed(3),
      totalKE:  +sumKE.toFixed(1),
      centerOfMass: [+(sumPx / n).toFixed(2), +(sumPy / n).toFixed(2), +(sumPz / n).toFixed(2)],
    };
  }

  async readPositions(): Promise<Float32Array> {
    const byteLen = this.count * FLOATS_PER_BODY * 4;
    if (byteLen === 0) return new Float32Array(0);

    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.bodyBuf, 0, this.readBuf, 0, byteLen);
    this.device.queue.submit([enc.finish()]);

    await this.readBuf.mapAsync(GPUMapMode.READ, 0, byteLen);
    const data = new Float32Array(this.readBuf.getMappedRange(0, byteLen).slice(0));
    this.readBuf.unmap();
    return data;
  }

  destroy(): void {
    this.bodyBuf.destroy();
    this.paramsBuf.destroy();
    this.readBuf.destroy();
    this.gridCountBuf.destroy();
    this.gridBodiesBuf.destroy();
    this.setRadiusParamBuf.destroy();
    this.statsBuf.destroy();
    this.statsReadBuf.destroy();
    this.statsParamBuf.destroy();
  }
}
