import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RigidBody } from '../physics/RigidBody';
import { SphereCollider } from '../physics/colliders/SphereCollider';
import { PlaneCollider } from '../physics/colliders/PlaneCollider';
import { detectCollisions } from '../physics/CollisionDetection';
import { resolveCollisions } from '../physics/CollisionResolution';

function makeSphere(id: string, x: number, y: number, z: number, radius = 0.5): RigidBody {
  const body = new RigidBody(id, 'dynamic', 1.0, 0.7, 0.995, new SphereCollider(radius));
  body.position.set(x, y, z);
  return body;
}

function makeFloor(): RigidBody {
  return new RigidBody(
    'floor', 'static', Infinity, 1.0, 1.0,
    new PlaneCollider(new THREE.Vector3(0, 1, 0), 0),
  );
}

describe('Sphere–plane collision detection', () => {
  it('detects collision when sphere center is below radius', () => {
    const sphere = makeSphere('a', 0, 0.3, 0); // radius 0.5, center at y=0.3 → penetrates floor
    const floor = makeFloor();
    const manifolds = detectCollisions([sphere, floor]);
    expect(manifolds).toHaveLength(1);
    expect(manifolds[0].penetration).toBeCloseTo(0.2, 5);
  });

  it('does not detect collision when sphere is above floor', () => {
    const sphere = makeSphere('a', 0, 1.0, 0);
    const floor = makeFloor();
    const manifolds = detectCollisions([sphere, floor]);
    expect(manifolds).toHaveLength(0);
  });
});

describe('Sphere–plane collision resolution', () => {
  it('pushes sphere above floor after resolution', () => {
    const sphere = makeSphere('a', 0, 0.3, 0);
    sphere.velocity.set(0, -3, 0);
    const floor = makeFloor();
    const manifolds = detectCollisions([sphere, floor]);
    resolveCollisions(manifolds);
    expect(sphere.position.y).toBeCloseTo(0.5, 4);
  });

  it('reverses downward velocity on bounce', () => {
    const sphere = makeSphere('a', 0, 0.3, 0);
    sphere.velocity.set(0, -5, 0);
    sphere.restitution = 0.8;
    const floor = makeFloor();
    const manifolds = detectCollisions([sphere, floor]);
    resolveCollisions(manifolds);
    expect(sphere.velocity.y).toBeGreaterThan(0);
    expect(sphere.velocity.y).toBeCloseTo(4, 1); // 5 * 0.8
  });

  it('does not bounce with restitution 0', () => {
    const sphere = makeSphere('a', 0, 0.3, 0);
    sphere.velocity.set(0, -5, 0);
    sphere.restitution = 0.0;
    const floor = makeFloor();
    const manifolds = detectCollisions([sphere, floor]);
    resolveCollisions(manifolds);
    expect(sphere.velocity.y).toBeCloseTo(0, 5);
  });
});

describe('Sphere–sphere collision detection', () => {
  it('detects collision between overlapping spheres', () => {
    const a = makeSphere('a', -0.4, 5, 0);
    const b = makeSphere('b', 0.4, 5, 0); // distance = 0.8 < radiusSum 1.0
    const manifolds = detectCollisions([a, b]);
    expect(manifolds).toHaveLength(1);
    expect(manifolds[0].penetration).toBeCloseTo(0.2, 5);
  });

  it('does not detect collision when spheres are separated', () => {
    const a = makeSphere('a', -1, 5, 0);
    const b = makeSphere('b', 1, 5, 0); // distance = 2.0 >= radiusSum 1.0
    const manifolds = detectCollisions([a, b]);
    expect(manifolds).toHaveLength(0);
  });
});

describe('Sphere–sphere collision resolution', () => {
  it('exchanges velocities for equal mass, restitution=1', () => {
    const a = makeSphere('a', -0.4, 5, 0);
    a.velocity.set(2, 0, 0);
    a.restitution = 1.0;
    const b = makeSphere('b', 0.4, 5, 0);
    b.velocity.set(-2, 0, 0);
    b.restitution = 1.0;

    const manifolds = detectCollisions([a, b]);
    resolveCollisions(manifolds);

    expect(a.velocity.x).toBeCloseTo(-2, 3);
    expect(b.velocity.x).toBeCloseTo(2, 3);
  });

  it('separates overlapping spheres after position correction', () => {
    const a = makeSphere('a', -0.4, 5, 0);
    const b = makeSphere('b', 0.4, 5, 0);
    a.velocity.set(1, 0, 0);
    b.velocity.set(-1, 0, 0);

    const manifolds = detectCollisions([a, b]);
    resolveCollisions(manifolds);

    const dist = a.position.distanceTo(b.position);
    expect(dist).toBeGreaterThanOrEqual(1.0 - 1e-5);
  });
});
