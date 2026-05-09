import * as THREE from 'three';
import type { RigidBody } from './RigidBody';

export type ForceFieldType = 'wind' | 'vortex' | 'explosion' | 'attraction';

interface ForceFieldBase {
  id: string;
  type: ForceFieldType;
  duration: number; // remaining seconds, -1 = infinite
}

export interface WindField extends ForceFieldBase {
  type: 'wind';
  force: THREE.Vector3;
}

export interface VortexField extends ForceFieldBase {
  type: 'vortex';
  center: THREE.Vector3;
  tangentialStrength: number; // rotation (positive = CCW from above)
  inwardStrength: number;     // spiral inward
  liftStrength: number;       // upward force near center
}

export interface ExplosionField extends ForceFieldBase {
  type: 'explosion';
  center: THREE.Vector3;
  strength: number;
  radius: number;
}

export interface AttractionField extends ForceFieldBase {
  type: 'attraction';
  center: THREE.Vector3;
  strength: number;
}

export type ForceField = WindField | VortexField | ExplosionField | AttractionField;

const _UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3();
const _rNorm = new THREE.Vector3();
const _tangent = new THREE.Vector3();

export function applyForceField(field: ForceField, body: RigidBody): void {
  if (body.type === 'static') return;

  switch (field.type) {
    case 'wind': {
      // F = force * mass so that all bodies accelerate equally regardless of mass
      body.forceAccum.addScaledVector(field.force, body.mass);
      break;
    }

    case 'vortex': {
      _r.subVectors(body.position, field.center);
      _r.y = 0; // horizontal displacement only
      const dist = _r.length();
      if (dist < 0.05) break;

      _rNorm.copy(_r).divideScalar(dist);

      // Tangential: cross(rNorm, UP) → CCW rotation viewed from above
      _tangent.crossVectors(_rNorm, _UP);
      body.forceAccum.addScaledVector(_tangent, field.tangentialStrength * body.mass);

      // Inward spiral
      if (field.inwardStrength > 0) {
        body.forceAccum.addScaledVector(_rNorm, -field.inwardStrength * body.mass);
      }

      // Upward lift near center (Gaussian falloff, radius ~5 m)
      if (field.liftStrength > 0) {
        const liftFactor = Math.exp((-dist * dist) / 25);
        body.forceAccum.addScaledVector(_UP, field.liftStrength * liftFactor * body.mass);
      }
      break;
    }

    case 'explosion': {
      _r.subVectors(body.position, field.center);
      const dist = _r.length();
      if (dist >= field.radius || dist < 0.05) break;

      const falloff = 1 - dist / field.radius;
      // Apply as impulse directly to velocity (one-shot effect)
      body.velocity.addScaledVector(_r.divideScalar(dist), field.strength * falloff * body.inverseMass);
      break;
    }

    case 'attraction': {
      _r.subVectors(field.center, body.position);
      const dist = _r.length();
      if (dist < 0.05) break;

      body.forceAccum.addScaledVector(_r.divideScalar(dist), field.strength * body.mass);
      break;
    }
  }
}

// JSON shape from NL controller
export interface ForceFieldSpec {
  type: ForceFieldType;
  duration: number;
  force?: [number, number, number];
  center?: [number, number, number];
  tangentialStrength?: number;
  inwardStrength?: number;
  liftStrength?: number;
  strength?: number;
  radius?: number;
}

let _idCounter = 0;

export function specToField(spec: ForceFieldSpec): ForceField {
  const id = `ff_${_idCounter++}`;
  const center = spec.center
    ? new THREE.Vector3(...spec.center)
    : new THREE.Vector3(0, 0, 0);

  switch (spec.type) {
    case 'wind':
      return {
        id, type: 'wind', duration: spec.duration,
        force: new THREE.Vector3(...(spec.force ?? [5, 0, 0])),
      };
    case 'vortex':
      return {
        id, type: 'vortex', duration: spec.duration, center,
        tangentialStrength: spec.tangentialStrength ?? 10,
        inwardStrength: spec.inwardStrength ?? 3,
        liftStrength: spec.liftStrength ?? 5,
      };
    case 'explosion':
      return {
        id, type: 'explosion', duration: 0.1, center,
        strength: spec.strength ?? 20,
        radius: spec.radius ?? 10,
      };
    case 'attraction':
      return {
        id, type: 'attraction', duration: spec.duration, center,
        strength: spec.strength ?? 8,
      };
  }
}
