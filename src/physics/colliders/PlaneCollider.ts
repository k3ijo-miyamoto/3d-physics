import * as THREE from 'three';
import type { Collider } from './Collider';

export class PlaneCollider implements Collider {
  type = 'plane' as const;
  normal: THREE.Vector3;
  offset: number;

  constructor(normal: THREE.Vector3, offset: number) {
    this.normal = normal;
    this.offset = offset;
  }
}
