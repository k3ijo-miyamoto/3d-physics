export interface AttractorPoint {
  x: number; y: number; z: number; strength: number;
}

export class AttractorBody {
  x: number; y: number; z: number;
  vx = 0; vy = 0; vz = 0;
  ax = 0; ay = 0; az = 0;
  mass: number;
  strength: number;

  constructor(x: number, y: number, z: number, mass: number, strength: number) {
    this.x = x; this.y = y; this.z = z;
    this.mass = mass; this.strength = strength;
  }

  toPoint(): AttractorPoint {
    return { x: this.x, y: this.y, z: this.z, strength: this.strength };
  }
}

const REPEL_DIST     = 18;   // minimum separation (m)
const REPEL_STRENGTH = 12;   // repulsion force magnitude
const FLOOR_Y        = 0;    // floor bounce height
const CEIL_Y         = 60;   // upper bound — bodies bounce off ceiling
const RESTITUTION    = 0.4;
const DAMPING        = 0.998;

export function stepAttractorBodies(bodies: AttractorBody[], dt: number, _gravityY: number): void {
  // No world gravity — attractor bodies float freely
  for (const b of bodies) {
    b.ax = 0;
    b.ay = 0;
    b.az = 0;
  }

  // Pairwise repulsion only — keeps bodies spread apart
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const r  = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
      if (r >= REPEL_DIST) continue;
      const f  = REPEL_STRENGTH * (REPEL_DIST - r) / (r * a.mass);
      const nx = dx / r, ny = dy / r, nz = dz / r;
      a.ax += f * nx; a.ay += f * ny; a.az += f * nz;
      b.ax -= f * nx; b.ay -= f * ny; b.az -= f * nz;
    }
  }

  // Integrate
  for (const b of bodies) {
    b.vx = (b.vx + b.ax * dt) * DAMPING;
    b.vz = (b.vz + b.az * dt) * DAMPING;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    // y は固定（変化させない）
    b.vy = 0;
  }
}
