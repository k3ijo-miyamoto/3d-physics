import * as THREE from 'three';
import type { RigidBody } from './RigidBody';

export interface CollisionManifold {
  bodyA: RigidBody;
  bodyB: RigidBody;
  // Points from bodyA toward bodyB (separation direction for A)
  normal: THREE.Vector3;
  penetration: number;
}
