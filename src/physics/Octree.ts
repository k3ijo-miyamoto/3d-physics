import * as THREE from 'three';
import type { RigidBody } from './RigidBody';
import { SphereCollider } from './colliders/SphereCollider';

const BRUTE_FORCE_THRESHOLD = 8;
const MAX_BODIES_PER_NODE = 8;
const MAX_DEPTH = 7;

class AABB {
  constructor(
    readonly min: THREE.Vector3,
    readonly max: THREE.Vector3,
  ) {}

  center(): THREE.Vector3 {
    return new THREE.Vector3(
      (this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2,
      (this.min.z + this.max.z) / 2,
    );
  }

  // True if the sphere (center, radius) is fully inside this AABB
  containsSphere(center: THREE.Vector3, radius: number): boolean {
    return (
      center.x - radius >= this.min.x &&
      center.x + radius <= this.max.x &&
      center.y - radius >= this.min.y &&
      center.y + radius <= this.max.y &&
      center.z - radius >= this.min.z &&
      center.z + radius <= this.max.z
    );
  }
}

class OctreeNode {
  bodies: RigidBody[] = [];
  children: OctreeNode[] | null = null;

  constructor(
    private bounds: AABB,
    private depth: number,
  ) {}

  insert(body: RigidBody): void {
    const radius = (body.collider as SphereCollider).radius;

    if (this.children) {
      const child = this.findContainingChild(body.position, radius);
      if (child) {
        child.insert(body);
        return;
      }
      // Body spans multiple children — keep in this node
      this.bodies.push(body);
      return;
    }

    this.bodies.push(body);
    if (this.bodies.length > MAX_BODIES_PER_NODE && this.depth < MAX_DEPTH) {
      this.split();
    }
  }

  private findContainingChild(pos: THREE.Vector3, radius: number): OctreeNode | null {
    if (!this.children) return null;
    for (const child of this.children) {
      if (child.bounds.containsSphere(pos, radius)) return child;
    }
    return null;
  }

  private split(): void {
    const c = this.bounds.center();
    const { min, max } = this.bounds;

    // Build 8 children (index encodes octant: bit0=x, bit1=y, bit2=z)
    this.children = [
      new OctreeNode(new AABB(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(c.x, c.y, c.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(c.x, min.y, min.z), new THREE.Vector3(max.x, c.y, c.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(min.x, c.y, min.z), new THREE.Vector3(c.x, max.y, c.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(c.x, c.y, min.z), new THREE.Vector3(max.x, max.y, c.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(min.x, min.y, c.z), new THREE.Vector3(c.x, c.y, max.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(c.x, min.y, c.z), new THREE.Vector3(max.x, c.y, max.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(min.x, c.y, c.z), new THREE.Vector3(c.x, max.y, max.z)), this.depth + 1),
      new OctreeNode(new AABB(new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(max.x, max.y, max.z)), this.depth + 1),
    ];

    // Re-distribute existing bodies into children
    const remaining: RigidBody[] = [];
    for (const body of this.bodies) {
      const radius = (body.collider as SphereCollider).radius;
      const child = this.findContainingChild(body.position, radius);
      if (child) child.bodies.push(body);
      else remaining.push(body);
    }
    this.bodies = remaining;
  }

  // Collect candidate pairs via DFS.
  // ancestorBodies: bodies from ancestor nodes — must test against all of them.
  // Correctness guarantee: if A fits in child X and B fits in child Y (different children),
  // the partition plane separates them by at least rA + rB, so they can't collide.
  // Therefore only same-node and ancestor pairs need testing.
  collectPairs(result: [RigidBody, RigidBody][], ancestors: RigidBody[]): void {
    // Test this node's bodies vs ancestor bodies
    for (const body of this.bodies) {
      for (const anc of ancestors) {
        result.push([body, anc]);
      }
    }

    // Test all pairs within this node
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        result.push([this.bodies[i], this.bodies[j]]);
      }
    }

    if (this.children) {
      const next = ancestors.length === 0 ? this.bodies : [...ancestors, ...this.bodies];
      for (const child of this.children) {
        child.collectPairs(result, next);
      }
    }
  }
}

// World AABB: large enough to contain all practical simulation objects
const WORLD_BOUNDS = new AABB(
  new THREE.Vector3(-128, -128, -128),
  new THREE.Vector3(128, 128, 128),
);

export function getSpherePairs(bodies: RigidBody[]): [RigidBody, RigidBody][] {
  if (bodies.length < 2) return [];

  // Fall back to brute force for small counts (avoids octree overhead)
  if (bodies.length <= BRUTE_FORCE_THRESHOLD) {
    const pairs: [RigidBody, RigidBody][] = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        pairs.push([bodies[i], bodies[j]]);
      }
    }
    return pairs;
  }

  const root = new OctreeNode(WORLD_BOUNDS, 0);
  for (const body of bodies) root.insert(body);

  const pairs: [RigidBody, RigidBody][] = [];
  root.collectPairs(pairs, []);
  return pairs;
}
