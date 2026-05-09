import * as THREE from 'three';
import type { RigidBody } from '../physics/RigidBody';

interface LogEntry {
  time: number;
  bodyId: string;
  posX: number; posY: number; posZ: number;
  velX: number; velY: number; velZ: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
}

export class SimulationLogger {
  private entries: LogEntry[] = [];
  enabled = false;

  log(time: number, bodies: RigidBody[], gravity: THREE.Vector3): void {
    if (!this.enabled) return;
    for (const body of bodies) {
      if (body.type === 'static') continue;
      const speed = body.velocity.length();
      const ke = 0.5 * body.mass * speed * speed;
      const pe = body.mass * Math.abs(gravity.y) * Math.max(0, body.position.y);
      this.entries.push({
        time,
        bodyId: body.id,
        posX: body.position.x,
        posY: body.position.y,
        posZ: body.position.z,
        velX: body.velocity.x,
        velY: body.velocity.y,
        velZ: body.velocity.z,
        kineticEnergy: ke,
        potentialEnergy: pe,
        totalEnergy: ke + pe,
      });
    }
  }

  exportCSV(): string {
    const header = 'time,bodyId,posX,posY,posZ,velX,velY,velZ,kineticEnergy,potentialEnergy,totalEnergy';
    const rows = this.entries.map(
      (e) =>
        `${e.time.toFixed(4)},${e.bodyId},${e.posX.toFixed(4)},${e.posY.toFixed(4)},` +
        `${e.posZ.toFixed(4)},${e.velX.toFixed(4)},${e.velY.toFixed(4)},${e.velZ.toFixed(4)},` +
        `${e.kineticEnergy.toFixed(4)},${e.potentialEnergy.toFixed(4)},${e.totalEnergy.toFixed(4)}`,
    );
    return [header, ...rows].join('\n');
  }

  downloadCSV(): void {
    const csv = this.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulation_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clear(): void {
    this.entries = [];
  }

  get entryCount(): number {
    return this.entries.length;
  }
}
