// Glowing attractor marker shader — additive blending, pulsating billboard
const ATR_MAX = 64;
const ATTRACTOR_WGSL = /* wgsl */`
struct AttractorParams {
  points  : array<vec4f, ${ATR_MAX}>, // xyz = position, w = strength (0 = inactive)
  timePad : vec4f,                    // x = time
}
struct Camera { viewProj: mat4x4f, view: mat4x4f, eyePos: vec4f }

@group(0) @binding(0) var<uniform> atr: AttractorParams;
@group(1) @binding(0) var<uniform> cam: Camera;

const QUAD = array<vec2f, 6>(
  vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
  vec2f(-1, 1), vec2f(1,-1), vec2f( 1,1),
);

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
  @location(1)       str : f32,
  @location(2)       idx : f32,
}

// Procedural HSV→RGB so any number of attractors get distinct colors
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3f {
  let c = v * s;
  let x = c * (1.0 - abs(fract(h * 6.0) * 2.0 - 1.0));
  let m = v - c;
  let hi = u32(h * 6.0) % 6u;
  var rgb: vec3f;
  if      (hi == 0u) { rgb = vec3f(c, x, 0.0); }
  else if (hi == 1u) { rgb = vec3f(x, c, 0.0); }
  else if (hi == 2u) { rgb = vec3f(0.0, c, x); }
  else if (hi == 3u) { rgb = vec3f(0.0, x, c); }
  else if (hi == 4u) { rgb = vec3f(x, 0.0, c); }
  else               { rgb = vec3f(c, 0.0, x); }
  return rgb + m;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = atr.points[ii];
  var out: VOut;
  out.str = p.w;
  out.idx = f32(ii);
  if (p.w == 0.0) {
    out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.uv  = vec2f(0.0);
    return out;
  }
  let t     = atr.timePad.x;
  let pulse = 1.0 + 0.18 * sin(t * 3.0 + f32(ii) * 1.31);
  let r     = 4.0 * pulse;
  let right = vec3f(cam.view[0][0], cam.view[1][0], cam.view[2][0]);
  let up    = vec3f(cam.view[0][1], cam.view[1][1], cam.view[2][1]);
  let local = QUAD[vi];
  let wp    = p.xyz + right * (local.x * r) + up * (local.y * r);
  out.pos   = cam.viewProj * vec4f(wp, 1.0);
  out.uv    = local;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (in.str == 0.0) { discard; }
  let d    = length(in.uv);
  if (d > 1.0) { discard; }
  let core = 1.0 - smoothstep(0.0, 0.18, d);
  let halo = pow(1.0 - d, 2.5) * 0.65;
  let glow = core + halo;
  let hue  = fract(in.idx / f32(${ATR_MAX})); // 均等に色相を分配
  let col  = mix(hsv2rgb(hue, 0.85, 1.0), vec3f(1.0), core * 0.6);
  return vec4f(col * glow, min(glow, 1.0));
}
`;

// Body layout mirrors GPUPhysicsWorld: pos = (x,y,z,radius), vel = (vx,vy,vz,inverseMass)
const SPHERE_WGSL = /* wgsl */`
struct Body { pos: vec4f, vel: vec4f }
struct Camera { viewProj: mat4x4f, view: mat4x4f, eyePos: vec4f }

@group(0) @binding(0) var<storage, read> bodies: array<Body>;
@group(1) @binding(0) var<uniform> cam: Camera;

const QUAD = array<vec2f, 6>(
  vec2f(-1, -1), vec2f( 1, -1), vec2f(-1,  1),
  vec2f(-1,  1), vec2f( 1, -1), vec2f( 1,  1),
);

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) speed: f32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let body = bodies[ii];
  let center = body.pos.xyz;
  let r = body.pos.w;
  // Camera right/up from view matrix rows (stored column-major)
  let right = vec3f(cam.view[0][0], cam.view[1][0], cam.view[2][0]);
  let up    = vec3f(cam.view[0][1], cam.view[1][1], cam.view[2][1]);
  let local = QUAD[vi];
  let worldPos = center + right * (local.x * r) + up * (local.y * r);
  var out: VOut;
  out.pos   = cam.viewProj * vec4f(worldPos, 1.0);
  out.uv    = local;
  out.speed = length(body.vel.xyz);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  let t    = clamp(in.speed / 15.0, 0.0, 1.0);
  let base = mix(vec3f(0.18, 0.48, 1.0), vec3f(1.0, 0.34, 0.05), t);
  let n    = vec3f(in.uv, sqrt(max(0.0, 1.0 - d * d)));
  let L    = normalize(vec3f(1.0, 2.0, 1.5));
  let H    = normalize(L + vec3f(0.0, 0.0, 1.0));
  let diff = max(dot(n, L), 0.0);
  let spec = pow(max(dot(n, H), 0.0), 32.0);
  return vec4f(base * (0.25 + 0.75 * diff) + vec3f(0.7) * spec, 1.0);
}
`;

const FLOOR_WGSL = /* wgsl */`
struct Camera { viewProj: mat4x4f, view: mat4x4f, eyePos: vec4f }
@group(0) @binding(0) var<uniform> cam: Camera;

const VERTS = array<vec2f, 6>(
  vec2f(-100, -100), vec2f(100, -100), vec2f(-100, 100),
  vec2f(-100, 100), vec2f(100, -100), vec2f(100, 100),
);

struct FOut { @builtin(position) pos: vec4f, @location(0) xz: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FOut {
  let xz = VERTS[vi];
  return FOut(cam.viewProj * vec4f(xz.x, 0.0, xz.y, 1.0), xz);
}

@fragment
fn fs(in: FOut) -> @location(0) vec4f {
  let g    = fract(in.xz);
  let line = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  let t    = 1.0 - smoothstep(0.0, 0.04, line);
  return vec4f(mix(vec3f(0.07, 0.07, 0.11), vec3f(0.22, 0.22, 0.32), t), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Column-major matrix math for WebGPU (z NDC ∈ [0, 1])
// ---------------------------------------------------------------------------

function perspectiveMat4(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nr = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0,           0,
    0,          f, 0,           0,
    0,          0, far * nr,   -1,
    0,          0, near*far*nr, 0,
  ]);
}

function lookAtMat4(
  eye: readonly [number, number, number],
  tgt: readonly [number, number, number],
  worldUp: readonly [number, number, number],
): Float32Array {
  // z = normalize(eye - target)
  let zx = eye[0]-tgt[0], zy = eye[1]-tgt[1], zz = eye[2]-tgt[2];
  let l = Math.sqrt(zx*zx + zy*zy + zz*zz);
  zx/=l; zy/=l; zz/=l;
  // x = normalize(cross(worldUp, z))
  let xx = worldUp[1]*zz - worldUp[2]*zy;
  let xy = worldUp[2]*zx - worldUp[0]*zz;
  let xz = worldUp[0]*zy - worldUp[1]*zx;
  l = Math.sqrt(xx*xx + xy*xy + xz*xz);
  if (l < 1e-10) { xx = 1; xy = 0; xz = 0; } else { xx/=l; xy/=l; xz/=l; }
  // y = cross(z, x)
  const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
  // prettier-ignore
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx*eye[0]+xy*eye[1]+xz*eye[2]),
    -(yx*eye[0]+yy*eye[1]+yz*eye[2]),
    -(zx*eye[0]+zy*eye[1]+zz*eye[2]),
    1,
  ]);
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
      out[c*4+r] = s;
    }
  return out;
}

// ---------------------------------------------------------------------------
// WebGPUSceneRenderer — direct GPU buffer rendering, zero CPU readback
// ---------------------------------------------------------------------------

export class WebGPUSceneRenderer {
  readonly canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;
  private device: GPUDevice;
  private format: GPUTextureFormat;

  private camBuf: GPUBuffer;
  private depthTex: GPUTexture | null = null;

  private spherePipeline: GPURenderPipeline;
  private floorPipeline: GPURenderPipeline;
  private attractorPipeline: GPURenderPipeline;
  private sphereBG0: GPUBindGroup;
  private sphereBG1: GPUBindGroup;
  private floorBG: GPUBindGroup;
  private attractorBG0: GPUBindGroup;
  private attractorBG1: GPUBindGroup;
  private attractorBuf: GPUBuffer; // 5×vec4f(pos+str) + time + pad = 96 bytes

  // Orbit camera
  private azimuth = 0.3;
  private elevation = 0.5;
  private dist = 20;
  private readonly tgt: [number, number, number] = [0, 3, 0];
  private dragging = false;
  private lastMX = 0;
  private lastMY = 0;
  private readonly keys = new Set<string>();
  private readonly MOVE_SPEED = 0.4;

  constructor(container: HTMLElement, device: GPUDevice, bodyBuf: GPUBuffer) {
    this.device = device;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    });
    container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.setCanvasSize(container);

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('Failed to get WebGPU canvas context');
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });

    // Camera uniform: viewProj(64) + view(64) + eyePos(16) = 144 bytes, pad to 160
    this.camBuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const bodiesBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ]});
    const camBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});

    const depth: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const sphereMod = device.createShaderModule({ code: SPHERE_WGSL });
    const floorMod  = device.createShaderModule({ code: FLOOR_WGSL });

    this.spherePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bodiesBGL, camBGL] }),
      vertex:   { module: sphereMod, entryPoint: 'vs' },
      fragment: { module: sphereMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth,
    });
    this.floorPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [camBGL] }),
      vertex:   { module: floorMod, entryPoint: 'vs' },
      fragment: { module: floorMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth,
    });

    this.sphereBG0 = device.createBindGroup({ layout: bodiesBGL, entries: [{ binding: 0, resource: { buffer: bodyBuf } }] });
    this.sphereBG1 = device.createBindGroup({ layout: camBGL,    entries: [{ binding: 0, resource: { buffer: this.camBuf } }] });
    this.floorBG   = device.createBindGroup({ layout: camBGL,    entries: [{ binding: 0, resource: { buffer: this.camBuf } }] });

    // Attractor marker pipeline (additive blending, no depth write)
    // 32 × vec4f(16B) + vec4f timePad(16B) = 528 bytes
    this.attractorBuf = device.createBuffer({ size: ATR_MAX * 16 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const atrBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});
    const atrMod = device.createShaderModule({ code: ATTRACTOR_WGSL });
    const additive: GPUBlendComponent = { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' };
    this.attractorPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [atrBGL, camBGL] }),
      vertex:   { module: atrMod, entryPoint: 'vs' },
      fragment: { module: atrMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: additive, alpha: additive } }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    this.attractorBG0 = device.createBindGroup({ layout: atrBGL, entries: [{ binding: 0, resource: { buffer: this.attractorBuf } }] });
    this.attractorBG1 = device.createBindGroup({ layout: camBGL, entries: [{ binding: 0, resource: { buffer: this.camBuf } }] });

    this.createDepthTex();
    this.setupInput();
    window.addEventListener('resize', () => { this.setCanvasSize(container); this.createDepthTex(); });
  }

  private setCanvasSize(container: HTMLElement): void {
    const dpr = window.devicePixelRatio;
    this.canvas.width  = Math.max(1, Math.floor(container.clientWidth  * dpr));
    this.canvas.height = Math.max(1, Math.floor(container.clientHeight * dpr));
  }

  private createDepthTex(): void {
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private getEye(): [number, number, number] {
    const [tx, ty, tz] = this.tgt;
    const cosEl = Math.cos(this.elevation);
    return [
      tx + this.dist * cosEl * Math.sin(this.azimuth),
      ty + this.dist * Math.sin(this.elevation),
      tz + this.dist * cosEl * Math.cos(this.azimuth),
    ];
  }

  private updateCamera(): void {
    const eye  = this.getEye();
    const view = lookAtMat4(eye, this.tgt, [0, 1, 0]);
    const proj = perspectiveMat4(Math.PI / 3, this.canvas.width / this.canvas.height, 0.1, 1000);
    const vp   = mat4Mul(proj, view);
    const data = new Float32Array(40);
    data.set(vp, 0); data.set(view, 16); data.set(eye, 32);
    this.device.queue.writeBuffer(this.camBuf, 0, data);
  }

  private setupInput(): void {
    this.canvas.addEventListener('mousedown', (e) => { this.dragging = true; this.lastMX = e.clientX; this.lastMY = e.clientY; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastMX;
      const dy = e.clientY - this.lastMY;
      this.azimuth -= dx * 0.005;
      // 上ドラッグ(dy<0) → tgt[1] 増加 → 視点が上へ
      this.tgt[1] = Math.max(0, this.tgt[1] - dy * 0.06);
      this.lastMX = e.clientX; this.lastMY = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.dist = Math.max(3, Math.min(800, this.dist + e.deltaY * 0.05));
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'r') {
        this.azimuth = 0.3; this.elevation = 0.5; this.dist = 20;
        this.tgt[0] = 0; this.tgt[1] = 3; this.tgt[2] = 0;
      }
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
  }

  private applyWASD(): void {
    // Horizontal forward direction based on current azimuth
    const fwdX = -Math.sin(this.azimuth);
    const fwdZ = -Math.cos(this.azimuth);
    const rgtX =  Math.cos(this.azimuth);
    const rgtZ = -Math.sin(this.azimuth);
    const spd  = this.MOVE_SPEED;
    if (this.keys.has('w') || this.keys.has('arrowup'))    { this.tgt[0] += fwdX*spd; this.tgt[2] += fwdZ*spd; }
    if (this.keys.has('s') || this.keys.has('arrowdown'))  { this.tgt[0] -= fwdX*spd; this.tgt[2] -= fwdZ*spd; }
    if (this.keys.has('d') || this.keys.has('arrowright')) { this.tgt[0] += rgtX*spd; this.tgt[2] += rgtZ*spd; }
    if (this.keys.has('a') || this.keys.has('arrowleft'))  { this.tgt[0] -= rgtX*spd; this.tgt[2] -= rgtZ*spd; }
    if (this.keys.has('e') || this.keys.has(' '))          { this.tgt[1] += spd; }
    if (this.keys.has('q') || this.keys.has('shift'))      { this.tgt[1] -= spd; }
  }

  setAttractors(points: Array<{ x: number; y: number; z: number; strength: number }>, time: number): void {
    const data = new Float32Array(132); // 528 bytes / 4
    for (let i = 0; i < ATR_MAX; i++) {
      const p = points[i] ?? { x: 0, y: 0, z: 0, strength: 0 };
      data[i * 4]     = p.x;
      data[i * 4 + 1] = p.y;
      data[i * 4 + 2] = p.z;
      data[i * 4 + 3] = p.strength;
    }
    data[ATR_MAX * 4] = time; // timePad.x
    this.device.queue.writeBuffer(this.attractorBuf, 0, data);
  }

  render(count: number): void {
    const swapTex = this.context.getCurrentTexture();
    if (!swapTex || !this.depthTex) return;
    this.applyWASD();
    this.updateCamera();

    const enc  = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: swapTex.createView(),
        clearValue: { r: 0.07, g: 0.07, b: 0.11, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard',
      },
    });

    // Floor
    pass.setPipeline(this.floorPipeline);
    pass.setBindGroup(0, this.floorBG);
    pass.draw(6);

    // Spheres — reads bodyBuf directly, no CPU readback
    if (count > 0) {
      pass.setPipeline(this.spherePipeline);
      pass.setBindGroup(0, this.sphereBG0);
      pass.setBindGroup(1, this.sphereBG1);
      pass.draw(6, count);
    }

    // Attractor markers — up to 32 instances, additive glow
    pass.setPipeline(this.attractorPipeline);
    pass.setBindGroup(0, this.attractorBG0);
    pass.setBindGroup(1, this.attractorBG1);
    pass.draw(6, ATR_MAX);

    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  dispose(): void {
    this.depthTex?.destroy();
    this.camBuf.destroy();
    this.canvas.remove();
  }
}
