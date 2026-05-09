import * as THREE from 'three';
import type { Collider } from './colliders/Collider';

export type RigidBodyType = 'dynamic' | 'static';

export class RigidBody {
  id: string;
  type: RigidBodyType;

  position: THREE.Vector3;
  velocity: THREE.Vector3;
  forceAccum: THREE.Vector3;

  mass: number;
  inverseMass: number;

  restitution: number;
  linearDamping: number;

  collider: Collider;

  constructor(
    id: string,
    type: RigidBodyType,
    mass: number,
    restitution: number,
    linearDamping: number,
    collider: Collider,
  ) {
    this.id = id;
    this.type = type;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.forceAccum = new THREE.Vector3();
    this.mass = mass;
    this.inverseMass = type === 'static' ? 0 : 1 / mass;
    this.restitution = restitution;
    this.linearDamping = linearDamping;
    this.collider = collider;
  }
}
