#!/usr/bin/env node
/**
 * Scenario player for the 3D physics simulation.
 * Usage: node run_scenario.mjs scenarios/my_scenario.json
 *
 * Connects via WebSocket to ws://localhost:5175 (Vite bridge).
 * Checks the scenario's pinned git commit against the current HEAD and warns on mismatch.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { WebSocket } from 'ws';

const BRIDGE_URL = 'ws://localhost:5175';

// ---- arg check ----
const scenarioPath = process.argv[2];
if (!scenarioPath) {
  console.error('Usage: node run_scenario.mjs <scenario.json>');
  process.exit(1);
}

const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));

// ---- version check ----
try {
  const currentHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const pinnedHash = scenario.version;
  if (pinnedHash && currentHash !== pinnedHash) {
    console.warn(`⚠  Version mismatch: scenario pinned to ${pinnedHash}, current HEAD is ${currentHash}`);
    console.warn('   Results may differ from the original recording.');
  } else if (pinnedHash) {
    console.log(`✓  Version match: ${currentHash}`);
  }
} catch {
  console.warn('⚠  Could not determine git version.');
}

// ---- connect ----
console.log(`\nRunning scenario: "${scenario.name}"`);
if (scenario.description) console.log(`  ${scenario.description}\n`);

const ws = new WebSocket(BRIDGE_URL);

ws.on('error', (e) => {
  console.error(`Connection failed: ${e.message}`);
  console.error('Is `npm run dev` running?');
  process.exit(1);
});

ws.on('open', async () => {
  // Apply setup params first
  const setup = scenario.setup ?? {};
  if (setup.gravity !== undefined) send({ type: 'set_gravity', y: setup.gravity });
  if (setup.damping !== undefined) send({ type: 'set_damping', value: setup.damping });
  if (setup.restitution !== undefined) send({ type: 'set_restitution', value: setup.restitution });
  if (setup.clearSpheres) send({ type: 'remove_all_spheres' });
  if (setup.clearEffects) send({ type: 'clear_effects' });

  // Execute steps
  for (let i = 0; i < (scenario.steps ?? []).length; i++) {
    const step = scenario.steps[i];
    if (step.wait > 0) {
      console.log(`  [${i + 1}/${scenario.steps.length}] waiting ${step.wait}ms...`);
      await sleep(step.wait);
    }
    console.log(`  [${i + 1}/${scenario.steps.length}] ${step.action}`);
    dispatchStep(step);
  }

  console.log('\nScenario complete.');
  ws.close();
});

function send(payload) {
  ws.send(JSON.stringify(payload));
}

function dispatchStep(step) {
  const p = step.params ?? {};
  switch (step.action) {
    case 'set_gravity':        send({ type: 'set_gravity', y: p.y ?? 0 }); break;
    case 'set_damping':        send({ type: 'set_damping', value: p.value }); break;
    case 'set_restitution':    send({ type: 'set_restitution', value: p.value }); break;
    case 'add_spheres_bulk':   send({ type: 'add_spheres_bulk', count: p.count, height: p.height }); break;
    case 'add_spheres_shell':  send({ type: 'add_spheres_shell', count: p.count, radius: p.radius ?? 120, thickness: p.thickness ?? 8 }); break;
    case 'remove_all_spheres': send({ type: 'remove_all_spheres' }); break;
    case 'remove_spheres':     send({ type: 'remove_spheres', count: p.count }); break;
    case 'set_attractors':     send({ type: 'set_attractors', points: padAttractors(p.points ?? []) }); break;
    case 'clear_effects':      send({ type: 'clear_effects' }); break;
    case 'apply_explosion':
      send({ type: 'apply_force_field', field: { type: 'explosion', center: p.center ?? [0, 0, 0], strength: p.strength ?? 25, radius: p.radius ?? 10, duration: 0.1 } });
      break;
    case 'apply_attraction':
      send({ type: 'apply_force_field', field: { type: 'attraction', center: p.center ?? [0, 30, 0], strength: p.strength ?? 10, duration: p.duration ?? -1 } });
      break;
    case 'apply_wind':
      send({ type: 'apply_force_field', field: { type: 'wind', force: p.force ?? [0, 0, 0], duration: p.duration ?? -1 } });
      break;
    case 'apply_vortex':
      send({ type: 'apply_force_field', field: { type: 'vortex', center: p.center ?? [0, 30, 0], tangentialStrength: p.tangentialStrength ?? 15, inwardStrength: p.inwardStrength ?? 3, liftStrength: p.liftStrength ?? 0, yConfinementStr: p.yConfinementStr ?? 0, duration: p.duration ?? -1 } });
      break;
    case 'pause':              send({ type: 'pause_simulation' }); break;
    case 'resume':             send({ type: 'resume_simulation' }); break;
    case 'reset':              send({ type: 'reset_simulation' }); break;
    default:
      console.warn(`  Unknown action: ${step.action}`);
  }
}

function padAttractors(points) {
  const full = [...points];
  while (full.length < 64) full.push({ x: 0, y: 0, z: 0, strength: 0 });
  return full;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
