import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:5175');
const INTERVAL_MS = 8000;
const ADD_COUNT   = 250000;
const STRENGTH    = 25;
const MAX_POINTS  = 5;

const rand = (min, max) => Math.random() * (max - min) + min;
const randomPoint = () => ({
  x: rand(-60, 60),
  y: rand(5, 25),
  z: rand(-60, 60),
  strength: STRENGTH,
});

const points = [];

function addPoint() {
  if (points.length >= MAX_POINTS) points.shift(); // 古いものを押し出す
  const p = randomPoint();
  points.push(p);

  // 5点に満たない場合は strength=0 で補完
  const full = Array.from({ length: MAX_POINTS }, (_, i) => points[i] ?? { x: 0, y: 0, z: 0, strength: 0 });
  ws.send(JSON.stringify({ type: 'set_attractors', points: full }));
  ws.send(JSON.stringify({ type: 'add_spheres_bulk', count: ADD_COUNT, height: 30 }));

  process.stderr.write(`[auto] +${ADD_COUNT} spheres  attractor at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})  total points: ${points.length}\n`);
}

ws.on('open', () => {
  process.stderr.write('[auto] connected\n');
  addPoint();                              // 1点目を即座に追加
  setInterval(addPoint, INTERVAL_MS);      // 以降 8秒ごと
});

ws.on('close', () => process.stderr.write('[auto] disconnected\n'));
ws.on('error', () => {});
