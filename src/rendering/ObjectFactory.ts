import * as THREE from 'three';

const SPHERE_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12,
  0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e,
];
let colorIndex = 0;

export function createSphereMesh(radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.MeshPhongMaterial({
    color: SPHERE_COLORS[colorIndex++ % SPHERE_COLORS.length],
    shininess: 80,
  });
  return new THREE.Mesh(geo, mat);
}

export function createFloorMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(30, 30);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x555555,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

export function resetColorIndex(): void {
  colorIndex = 0;
}
