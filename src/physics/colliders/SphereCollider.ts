import type { Collider } from './Collider';

export class SphereCollider implements Collider {
  type = 'sphere' as const;
  radius: number;

  constructor(radius: number) {
    this.radius = radius;
  }
}
