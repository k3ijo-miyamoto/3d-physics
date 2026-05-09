import * as THREE from 'three';
import type { CollisionManifold } from './CollisionManifold';

export function resolveCollisions(manifolds: CollisionManifold[]): void {
  for (const m of manifolds) resolveManifold(m);
}

function resolveManifold(m: CollisionManifold): void {
  const { bodyA, bodyB, normal, penetration } = m;
  const totalInvMass = bodyA.inverseMass + bodyB.inverseMass;
  if (totalInvMass === 0) return;

  // Push bodies apart proportional to inverse mass (heavier body moves less)
  bodyA.position.addScaledVector(normal, -penetration * (bodyA.inverseMass / totalInvMass));
  bodyB.position.addScaledVector(normal, penetration * (bodyB.inverseMass / totalInvMass));

  // Velocity along normal: positive means separating, skip impulse
  const relVel = new THREE.Vector3().subVectors(bodyB.velocity, bodyA.velocity);
  const velAlongNormal = relVel.dot(normal);
  if (velAlongNormal > 0) return;

  const restitution = Math.min(bodyA.restitution, bodyB.restitution);
  const j = (-(1 + restitution) * velAlongNormal) / totalInvMass;

  bodyA.velocity.addScaledVector(normal, -j * bodyA.inverseMass);
  bodyB.velocity.addScaledVector(normal, j * bodyB.inverseMass);
}
