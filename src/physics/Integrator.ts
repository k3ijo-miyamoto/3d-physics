import * as THREE from 'three';
import type { RigidBody } from './RigidBody';

export function integrate(body: RigidBody, gravity: THREE.Vector3, dt: number): void {
  if (body.type === 'static') return;

  body.velocity.addScaledVector(gravity, dt);

  if (body.forceAccum.lengthSq() > 0) {
    body.velocity.addScaledVector(body.forceAccum, body.inverseMass * dt);
    body.forceAccum.set(0, 0, 0);
  }

  body.position.addScaledVector(body.velocity, dt);

  // Per-step damping (designed for fixed timestep use)
  body.velocity.multiplyScalar(body.linearDamping);
}
