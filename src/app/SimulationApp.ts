import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { RigidBody } from '../physics/RigidBody';
import { SphereCollider } from '../physics/colliders/SphereCollider';
import { PlaneCollider } from '../physics/colliders/PlaneCollider';
import { specToField } from '../physics/ForceField';
import { GPUPhysicsWorld } from '../physics/gpu/GPUPhysicsWorld';
import { Renderer3D } from '../rendering/Renderer3D';
import { createSphereMesh, createFloorMesh, resetColorIndex } from '../rendering/ObjectFactory';
import { SimulationControls, type SimulationParams } from '../ui/SimulationControls';
import { NLControlPanel } from '../ui/NLControlPanel';
import { SimulationLogger } from '../logging/SimulationLogger';
import { WebGPUSceneRenderer } from '../rendering/WebGPUSceneRenderer';
import { SimulationBridge } from '../simulation/SimulationBridge';

export class SimulationApp {
  private container: HTMLElement;
  private world: PhysicsWorld;
  private renderer3d: Renderer3D;
  private controls: SimulationControls;
  private logger: SimulationLogger;
  private nlPanel: NLControlPanel;
  readonly bridge: SimulationBridge;

  // CPU mode
  private meshMap = new Map<string, THREE.Mesh>();
  private dynamicIds = new Set<string>();

  // GPU mode
  private gpuWorld: GPUPhysicsWorld | null = null;
  private gpuSceneRenderer: WebGPUSceneRenderer | null = null;
  private gpuBtn: HTMLButtonElement;
  private autoExplosionTimer: ReturnType<typeof setInterval> | null = null;

  // Walls
  private wallBodies: RigidBody[] = [];
  private wallMeshes: THREE.Mesh[] = [];
  private wallsEnabled = false;
  private wallBtn: HTMLButtonElement;
  private readonly WALL_HALF = 28;
  private readonly WALL_HEIGHT = 45;

  private running = false;
  private accumulator = 0;
  private lastTime = 0;
  private simTime = 0;
  private idCounter = 0;
  private rafId = 0;

  // FPS counter
  private fpsEl: HTMLDivElement;
  private fpsFrames = 0;
  private fpsLast = 0;

  private params: SimulationParams = {
    gravityY: -9.81,
    restitution: 0.7,
    linearDamping: 0.995,
    sphereRadius: 0.1,
    sphereMass: 1.0,
    initialHeight: 5.0,
    randomVelocity: false,
    speedMultiplier: 1.0,
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.world = new PhysicsWorld();
    this.renderer3d = new Renderer3D(container);
    this.logger = new SimulationLogger();

    this.controls = new SimulationControls(this.params, {
      onAddSphere: () => this.addSphere(),
      onRemoveAll: () => this.removeAllSpheres(),
      onReset: () => this.reset(),
      onTogglePause: () => this.togglePause(),
      onGravityChange: (v) => {
        this.world.gravity.y = v;
        if (this.gpuWorld) this.gpuWorld.gravity.y = v;
      },
      onRestitutionChange: (v) => {
        for (const id of this.dynamicIds) {
          const body = this.world.bodies.find((b) => b.id === id);
          if (body) body.restitution = v;
        }
        if (this.gpuWorld) this.gpuWorld.restitution = v;
      },
      onDampingChange: (v) => {
        for (const id of this.dynamicIds) {
          const body = this.world.bodies.find((b) => b.id === id);
          if (body) body.linearDamping = v;
        }
        if (this.gpuWorld) this.gpuWorld.damping = v;
      },
      onSphereRadiusChange: (v) => {
        if (this.gpuWorld) this.gpuWorld.setAllRadii(v);
      },
      onExportCSV: () => this.logger.downloadCSV(),
      getSphereCount: () => this.gpuWorld ? this.gpuWorld.count : this.dynamicIds.size,
      isRunning: () => this.running,
    });

    this.nlPanel = new NLControlPanel(container, {
      onClearEffects: () => {
        this.world.clearForceFields();
        if (this.gpuWorld) {
          this.gpuWorld.wind = { x: 0, y: 0, z: 0 };
          this.gpuWorld.vortex = { centerX: 0, centerZ: 0, tangentialStrength: 0, inwardStrength: 0, liftStrength: 0, enabled: false };
        }
      },
    });

    // GPU mode toggle button
    this.gpuBtn = document.createElement('button');
    this.gpuBtn.textContent = 'GPU モード ON';
    Object.assign(this.gpuBtn.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      padding: '8px 16px',
      background: '#1d4ed8',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '700',
      zIndex: '2000',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    });
    this.gpuBtn.addEventListener('click', () => this.toggleGPU());
    container.appendChild(this.gpuBtn);

    // Wall toggle button
    this.wallBtn = document.createElement('button');
    this.wallBtn.textContent = '壁を追加';
    Object.assign(this.wallBtn.style, {
      position: 'fixed',
      top: '56px',
      right: '16px',
      padding: '8px 16px',
      background: '#374151',
      color: '#d1d5db',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '700',
      zIndex: '2000',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    });
    this.wallBtn.addEventListener('click', () => this.toggleWalls());
    container.appendChild(this.wallBtn);

    this.bridge = new SimulationBridge({
      addSphere: (height) => {
        if (height !== undefined) this.params.initialHeight = height;
        this.addSphere();
      },
      addSpheresBulk: (count) => this.addSpheresBulk(count),
      removeAllSpheres: () => this.removeAllSpheres(),
      reset: () => this.reset(),
      pause: () => { if (this.running) this.togglePause(); },
      resume: () => { if (!this.running) this.togglePause(); },
      setGravity: (y) => {
        this.world.gravity.y = y;
        this.params.gravityY = y;
        if (this.gpuWorld) this.gpuWorld.gravity.y = y;
      },
      setRestitution: (value) => {
        this.params.restitution = value;
        for (const id of this.dynamicIds) {
          const body = this.world.bodies.find((b) => b.id === id);
          if (body) body.restitution = value;
        }
        if (this.gpuWorld) this.gpuWorld.restitution = value;
      },
      setDamping: (value) => {
        this.params.linearDamping = value;
        for (const id of this.dynamicIds) {
          const body = this.world.bodies.find((b) => b.id === id);
          if (body) body.linearDamping = value;
        }
        if (this.gpuWorld) this.gpuWorld.damping = value;
      },
      applyForceField: (spec) => {
        this.world.addForceField(specToField(spec));
        if (this.gpuWorld) {
          if (spec.type === 'wind' && spec.force) {
            this.gpuWorld.wind = { x: spec.force[0], y: spec.force[1], z: spec.force[2] };
          } else if (spec.type === 'vortex') {
            this.gpuWorld.vortex = {
              centerX: spec.center?.[0] ?? 0,
              centerZ: spec.center?.[2] ?? 0,
              tangentialStrength: spec.tangentialStrength ?? 15,
              inwardStrength: spec.inwardStrength ?? 3,
              liftStrength: spec.liftStrength ?? 6,
              enabled: true,
            };
          } else if (spec.type === 'explosion') {
            this.gpuWorld.explosion = {
              x: spec.center?.[0] ?? 0,
              y: spec.center?.[1] ?? 0,
              z: spec.center?.[2] ?? 0,
              strength: spec.strength ?? 25,
              radius: spec.radius ?? 10,
              enabled: true,
            };
          }
        }
      },
      clearEffects: () => {
        this.world.clearForceFields();
        if (this.gpuWorld) {
          this.gpuWorld.wind = { x: 0, y: 0, z: 0 };
          this.gpuWorld.vortex = { centerX: 0, centerZ: 0, tangentialStrength: 0, inwardStrength: 0, liftStrength: 0, enabled: false };
        }
      },
      removeWalls: () => this.removeWalls(),
      setSphereRadius: (value) => {
        this.params.sphereRadius = Math.max(0.1, Math.min(5, value));
      },
      startAutoExplosion: () => this.startAutoExplosion(),
      stopAutoExplosion: () => this.stopAutoExplosion(),
      setAttractors: (points) => this.setAttractors(points),
      getState: () => ({
        sphereCount: this.gpuWorld ? this.gpuWorld.count : this.dynamicIds.size,
        gpuMode: !!this.gpuWorld,
        gravityY: this.world.gravity.y,
        running: this.running,
        activeFields: this.world.forceFields.map((f) => ({ type: f.type, duration: f.duration })),
        bodies: this.gpuWorld ? [] : this.world.bodies
          .filter((b) => b.type === 'dynamic')
          .map((b) => ({
            id: b.id,
            pos: [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)],
            vel: [+b.velocity.x.toFixed(2), +b.velocity.y.toFixed(2), +b.velocity.z.toFixed(2)],
          })),
      }),
      onConnectionChange: (connected) => this.nlPanel.setMcpConnected(connected),
    });

    this.fpsEl = document.createElement('div');
    Object.assign(this.fpsEl.style, {
      position: 'fixed', top: '96px', right: '16px',
      fontFamily: 'monospace', fontSize: '13px', fontWeight: '700',
      color: '#4ade80', background: 'rgba(0,0,0,0.55)',
      padding: '4px 10px', borderRadius: '4px', zIndex: '2000',
      pointerEvents: 'none',
    });
    container.appendChild(this.fpsEl);

    this.addFloor();
    this.addSphere();
    this.start();
    void this.toggleGPU(); // GPU モードをデフォルトで有効化
  }

  startAutoExplosion(): void {
    if (this.autoExplosionTimer !== null) return;
    this.autoExplosionTimer = setInterval(() => {
      if (!this.gpuWorld) return;
      const spread = 20;
      this.gpuWorld.explosion = {
        x: (Math.random() - 0.5) * spread,
        y: 2 + Math.random() * 10,
        z: (Math.random() - 0.5) * spread,
        strength: 60,
        radius: 20,
        enabled: true,
      };
    }, 5000);
  }

  stopAutoExplosion(): void {
    if (this.autoExplosionTimer !== null) {
      clearInterval(this.autoExplosionTimer);
      this.autoExplosionTimer = null;
    }
  }

  setAttractors(points: Array<{ x: number; y: number; z: number; strength: number }>): void {
    if (!this.gpuWorld) return;
    for (let i = 0; i < 5; i++) {
      this.gpuWorld.attractors[i] = points[i] ?? { x: 0, y: 0, z: 0, strength: 0 };
    }
  }

  private addFloor(): void {
    const floorBody = new RigidBody(
      'floor', 'static', Infinity, 1.0, 1.0,
      new PlaneCollider(new THREE.Vector3(0, 1, 0), 0),
    );
    this.world.addBody(floorBody);

    const floorMesh = createFloorMesh();
    this.meshMap.set('floor', floorMesh);
    this.renderer3d.addMesh(floorMesh);
  }

  addSphere(): void {
    const { sphereRadius, sphereMass, initialHeight, restitution, linearDamping, randomVelocity } =
      this.params;

    if (this.gpuWorld) {
      const spread = 40;
      const x = (Math.random() - 0.5) * spread;
      const z = (Math.random() - 0.5) * spread;
      const vx = randomVelocity ? (Math.random() - 0.5) * 6 : 0;
      const vy = randomVelocity ? (Math.random() - 0.5) * 2 : 0;
      const vz = randomVelocity ? (Math.random() - 0.5) * 6 : 0;
      this.gpuWorld.addBody(x, initialHeight, z, sphereRadius, sphereMass, vx, vy, vz);
      this.controls.updateSphereCount(this.gpuWorld.count);
      return;
    }

    const id = `sphere_${this.idCounter++}`;
    const body = new RigidBody(
      id, 'dynamic', sphereMass, restitution, linearDamping, new SphereCollider(sphereRadius),
    );
    const spread = 4;
    body.position.set(
      (Math.random() - 0.5) * spread,
      initialHeight,
      (Math.random() - 0.5) * spread,
    );
    if (randomVelocity) {
      body.velocity.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 6,
      );
    }
    this.world.addBody(body);
    this.dynamicIds.add(id);

    const mesh = createSphereMesh(sphereRadius);
    mesh.position.copy(body.position);
    this.meshMap.set(id, mesh);
    this.renderer3d.addMesh(mesh);

    this.controls.updateSphereCount(this.dynamicIds.size);
  }

  addSpheresBulk(count: number): void {
    if (!this.gpuWorld) {
      for (let i = 0; i < count; i++) this.addSphere();
      return;
    }
    const { sphereRadius, sphereMass } = this.params;
    this.gpuWorld.addBodiesBulk(count, sphereRadius, sphereMass, 54, 0.5, 6, 0);
    this.controls.updateSphereCount(this.gpuWorld.count);
  }

  removeAllSpheres(): void {
    if (this.gpuWorld) {
      this.gpuWorld.removeAll();
      this.controls.updateSphereCount(0);
      return;
    }
    for (const id of this.dynamicIds) {
      this.world.removeBody(id);
      const mesh = this.meshMap.get(id);
      if (mesh) {
        this.renderer3d.removeMesh(mesh);
        this.meshMap.delete(id);
      }
    }
    this.dynamicIds.clear();
    resetColorIndex();
    this.controls.updateSphereCount(0);
  }

  reset(): void {
    this.removeAllSpheres();
    this.world.clearForceFields();
    this.simTime = 0;
    this.accumulator = 0;
    this.logger.clear();
    this.addSphere();
  }

  togglePause(): void {
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    } else {
      this.running = true;
      this.lastTime = performance.now();
      this.scheduleLoop();
    }
  }

  private async toggleGPU(): Promise<void> {
    if (this.gpuWorld) {
      this.disableGPU();
    } else {
      this.gpuBtn.disabled = true;
      this.gpuBtn.textContent = '初期化中...';
      try {
        await this.enableGPU();
      } catch (err) {
        alert(`WebGPU エラー: ${err instanceof Error ? err.message : String(err)}`);
        this.gpuBtn.textContent = 'GPU モード ON';
      } finally {
        this.gpuBtn.disabled = false;
      }
    }
  }

  private async enableGPU(): Promise<void> {
    // Remove all CPU spheres (keep floor)
    for (const id of this.dynamicIds) {
      this.world.removeBody(id);
      const mesh = this.meshMap.get(id);
      if (mesh) { this.renderer3d.removeMesh(mesh); this.meshMap.delete(id); }
    }
    this.dynamicIds.clear();
    resetColorIndex();

    const MAX = 1000000;
    this.gpuWorld = await GPUPhysicsWorld.create(MAX);
    this.gpuWorld.gravity.y = this.params.gravityY;
    this.gpuWorld.restitution = this.params.restitution;
    this.gpuWorld.damping = this.params.linearDamping;
    if (this.wallsEnabled) {
      this.gpuWorld.walls = { halfWidth: this.WALL_HALF, halfDepth: this.WALL_HALF, enabled: true };
    }

    // Full WebGPU renderer — reads body buffer directly, no CPU readback
    this.gpuSceneRenderer = new WebGPUSceneRenderer(
      this.container, this.gpuWorld.gpuDevice, this.gpuWorld.bodyBuffer,
    );
    this.renderer3d.renderer.domElement.style.display = 'none';

    // Seed with one sphere
    this.gpuWorld.addBody(0, this.params.initialHeight, 0, this.params.sphereRadius, this.params.sphereMass);
    this.controls.updateSphereCount(1);

    this.gpuBtn.textContent = 'CPU モードに戻る';
    this.gpuBtn.style.background = '#047857';
  }

  private disableGPU(): void {
    this.stopAutoExplosion();
    this.gpuSceneRenderer?.dispose();
    this.gpuSceneRenderer = null;
    this.renderer3d.renderer.domElement.style.display = '';

    this.gpuWorld?.destroy();
    this.gpuWorld = null;

    this.controls.updateSphereCount(this.dynamicIds.size);
    this.gpuBtn.textContent = 'GPU モード ON';
    this.gpuBtn.style.background = '#1d4ed8';
  }

  private toggleWalls(): void {
    if (this.wallsEnabled) {
      this.removeWalls();
    } else {
      this.addWalls();
    }
  }

  private addWalls(): void {
    const h = this.WALL_HALF;
    const wallH = this.WALL_HEIGHT;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // [normal, offset, meshPos, rotY]
    const defs: Array<{ nx: number; nz: number; offset: number; px: number; pz: number; ry: number }> = [
      { nx:  0, nz: -1, offset: -h, px:  0, pz:  h, ry: Math.PI },
      { nx:  0, nz:  1, offset: -h, px:  0, pz: -h, ry: 0 },
      { nx: -1, nz:  0, offset: -h, px:  h, pz:  0, ry: -Math.PI / 2 },
      { nx:  1, nz:  0, offset: -h, px: -h, pz:  0, ry:  Math.PI / 2 },
    ];

    for (const def of defs) {
      // CPU collision body
      const normal = new THREE.Vector3(def.nx, 0, def.nz);
      const body = new RigidBody(
        `wall_${this.wallBodies.length}`, 'static', Infinity, 1.0, 1.0,
        new PlaneCollider(normal, def.offset),
      );
      this.world.addBody(body);
      this.wallBodies.push(body);

      // Visual mesh
      const geo = new THREE.PlaneGeometry(h * 2, wallH);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(def.px, wallH / 2, def.pz);
      mesh.rotation.y = def.ry;
      this.renderer3d.addMesh(mesh);
      this.wallMeshes.push(mesh);
    }

    // GPU walls
    if (this.gpuWorld) {
      this.gpuWorld.walls = { halfWidth: h, halfDepth: h, enabled: true };
    }

    this.wallsEnabled = true;
    this.wallBtn.textContent = '壁を削除';
    this.wallBtn.style.background = '#1e3a5f';
    this.wallBtn.style.color = '#93c5fd';
  }

  private removeWalls(): void {
    for (const body of this.wallBodies) this.world.removeBody(body.id);
    this.wallBodies = [];

    for (const mesh of this.wallMeshes) {
      this.renderer3d.removeMesh(mesh);
      mesh.geometry.dispose();
    }
    this.wallMeshes = [];

    if (this.gpuWorld) {
      this.gpuWorld.walls = { halfWidth: this.WALL_HALF, halfDepth: this.WALL_HALF, enabled: false };
    }

    this.wallsEnabled = false;
    this.wallBtn.textContent = '壁を追加';
    this.wallBtn.style.background = '#374151';
    this.wallBtn.style.color = '#d1d5db';
  }

  private start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this.scheduleLoop();
  }

  private scheduleLoop(): void {
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  private loop = async (now: number): Promise<void> => {
    if (!this.running) return;

    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // FPS — update display once per second
    this.fpsFrames++;
    if (now - this.fpsLast >= 1000) {
      const fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsLast));
      const n = this.gpuWorld ? this.gpuWorld.count : this.dynamicIds.size;
      this.fpsEl.textContent = `${fps} FPS  |  ${n.toLocaleString()} 球`;
      this.fpsFrames = 0;
      this.fpsLast = now;
    }

    if (this.gpuWorld) {
      // GPU physics — compute shaders + WebGPU direct render, zero CPU readback
      this.accumulator += frameDt;
      const fixedDt = this.gpuWorld.fixedDt;
      let steps = 2; // cap to prevent GPU overload at high counts
      while (this.accumulator >= fixedDt && steps-- > 0) {
        this.gpuWorld.step(fixedDt);
        this.accumulator -= fixedDt;
      }
      if (this.accumulator > fixedDt * 3) this.accumulator = 0; // reset if too far behind
      this.gpuSceneRenderer?.render(this.gpuWorld.count);
    } else {
      // CPU physics path
      this.accumulator += frameDt * this.params.speedMultiplier;
      const fixedDt = this.world.fixedDt;
      while (this.accumulator >= fixedDt) {
        this.world.step(fixedDt);
        this.simTime += fixedDt;
        this.logger.log(this.simTime, this.world.bodies, this.world.gravity);
        this.accumulator -= fixedDt;
      }

      for (const [id, mesh] of this.meshMap) {
        const body = this.world.bodies.find((b) => b.id === id);
        if (body) mesh.position.copy(body.position);
      }

      this.nlPanel.updateActiveFields(this.world.forceFields.map((f) => f.type));
    }

    if (!this.gpuWorld) this.renderer3d.render();
    this.scheduleLoop();
  };
}
