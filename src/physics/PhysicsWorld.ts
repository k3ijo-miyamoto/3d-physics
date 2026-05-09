import * as THREE from 'three';
import type { RigidBody } from './RigidBody';
import type { ForceField } from './ForceField';
import { applyForceField } from './ForceField';
import { integrate } from './Integrator';
import { detectCollisions } from './CollisionDetection';
import { resolveCollisions } from './CollisionResolution';

export class PhysicsWorld {
  bodies: RigidBody[] = [];
  gravity: THREE.Vector3 = new THREE.Vector3(0, -9.81, 0);
  fixedDt: number = 1 / 60;
  forceFields: ForceField[] = [];

  addBody(body: RigidBody): void {
    this.bodies.push(body);
  }

  removeBody(id: string): void {
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }

  addForceField(field: ForceField): void {
    this.forceFields.push(field);
  }

  clearForceFields(): void {
    this.forceFields = [];
  }

  step(dt: number): void {
    // Apply force fields before integration
    for (const field of this.forceFields) {
      for (const body of this.bodies) {
        applyForceField(field, body);
      }
    }

    // Tick down timed force fields
    this.forceFields = this.forceFields.filter((f) => {
      if (f.duration < 0) return true;
      f.duration -= dt;
      return f.duration > 0;
    });

    for (const body of this.bodies) {
      integrate(body, this.gravity, dt);
    }

    const manifolds = detectCollisions(this.bodies);
    resolveCollisions(manifolds);
  }

  reset(): void {
    this.bodies = [];
    this.forceFields = [];
  }
}
