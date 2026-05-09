import * as THREE from 'three';

export function distance(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

export function dot(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.dot(b);
}

export function clampLength(v: THREE.Vector3, max: number): THREE.Vector3 {
  if (v.length() > max) v.setLength(max);
  return v;
}
