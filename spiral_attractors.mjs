import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:5175');
const RADIUS   = 12;
const OMEGA    = 0.25;   // 公転速度 rad/s
const Y_OMEGA  = 0.12;   // 上下振動速度
const Y_AMP    = 5;
const NUM      = 5;
const STRENGTH = 22;

// 5点のランダム中心 (XZ: ±60, Y: 5–20)
const rand = (min, max) => Math.random() * (max - min) + min;
const CENTERS = Array.from({ length: NUM }, () => ({
  x: rand(-60, 60),
  y: rand(5, 20),
  z: rand(-60, 60),
}));

process.stderr.write(`[spiral] centers: ${JSON.stringify(CENTERS)}\n`);

let t = 0;
let timer;

ws.on('open', () => {
  process.stderr.write('[spiral] connected\n');
  timer = setInterval(() => {
    t += 0.1;
    const points = CENTERS.map((c, i) => {
      const phase  = (2 * Math.PI * i) / NUM + OMEGA * t;
      const yPhase = (2 * Math.PI * i) / NUM + Y_OMEGA * t;
      return {
        x:        c.x + RADIUS * Math.cos(phase),
        y:        c.y + Y_AMP  * Math.sin(yPhase),
        z:        c.z + RADIUS * Math.sin(phase),
        strength: STRENGTH,
      };
    });
    ws.send(JSON.stringify({ type: 'set_attractors', points }));
  }, 100);
});

ws.on('close', () => {
  clearInterval(timer);
  process.stderr.write('[spiral] disconnected\n');
});

ws.on('error', () => {});
