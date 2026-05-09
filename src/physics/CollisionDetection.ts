import * as THREE from 'three';
import type { RigidBody } from './RigidBody';
import type { CollisionManifold } from './CollisionManifold';
import { SphereCollider } from './colliders/SphereCollider';
import { PlaneCollider } from './colliders/PlaneCollider';
import { getSpherePairs } from './Octree';

export function detectCollisions(bodies: RigidBody[]): CollisionManifold[] {
  const manifolds: CollisionManifold[] = [];

  const planes = bodies.filter((b) => b.collider.type === 'plane');
  const spheres = bodies.filter((b) => b.collider.type === 'sphere');

  // Sphere vs plane: O(n) — planes don't benefit from spatial indexing
  for (const sphere of spheres) {
    for (const plane of planes) {
      const m = detectSpherePlane(sphere, plane.collider as PlaneCollider, plane);
      if (m) manifolds.push(m);
    }
  }

  // Sphere vs sphere: broad phase via Octree, narrow phase per candidate pair
  for (const [a, b] of getSpherePairs(spheres)) {
    const m = detectSphereSphere(a, b);
    if (m) manifolds.push(m);
  }

  return manifolds;
}

function detectSpherePlane(
  sphere: RigidBody,
  planeCollider: PlaneCollider,
  plane: RigidBody,
): CollisionManifold | null {
  const sc = sphere.collider as SphereCollider;
  const dist = sphere.position.dot(planeCollider.normal) - planeCollider.offset;
  const penetration = sc.radius - dist;
  if (penetration <= 0) return null;

  // Normal points from sphere (bodyA) toward the plane surface (bodyB)
  return {
    bodyA: sphere,
    bodyB: plane,
    normal: planeCollider.normal.clone().negate(),
    penetration,
  };
}

function detectSphereSphere(a: RigidBody, b: RigidBody): CollisionManifold | null {
  const ca = a.collider as SphereCollider;
  const cb = b.collider as SphereCollider;

  const diff = new THREE.Vector3().subVectors(b.position, a.position);
  const dist = diff.length();
  const radiusSum = ca.radius + cb.radius;
  if (dist >= radiusSum) return null;

  // Normal points from a toward b
  const normal = dist > 1e-8 ? diff.divideScalar(dist) : new THREE.Vector3(0, 1, 0);

  return { bodyA: a, bodyB: b, normal, penetration: radiusSum - dist };
}
