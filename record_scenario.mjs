#!/usr/bin/env node
/**
 * Scenario recorder for the 3D physics simulation.
 * Usage: node record_scenario.mjs [--name "シナリオ名"] [--desc "説明"]
 *
 * 1. Run this script (connects to ws://localhost:5175)
 * 2. Operate the simulation via MCP, scripts, or UI
 * 3. Press Ctrl+C to stop recording
 * 4. Scenario is saved to scenarios/recorded_<timestamp>.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { WebSocket } from 'ws';

const BRIDGE_URL = 'ws://localhost:5175';

// Parse --name and --desc args
const args = process.argv.slice(2);
let name = 'recorded_scenario';
let desc = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) name = args[++i];
  if (args[i] === '--desc' && args[i + 1]) desc = args[++i];
}

const requestId = `rec_${Date.now()}`;
const ws = new WebSocket(BRIDGE_URL);

ws.on('error', (e) => {
  console.error(`Connection failed: ${e.message}`);
  console.error('Is `npm run dev` running?');
  process.exit(1);
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'start_recording', name, description: desc }));
  console.log(`\n● 録画開始: "${name}"`);
  console.log('  操作してください。Ctrl+C で録画を停止して保存します。\n');
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'recording_response' && msg.requestId === requestId) {
      saveScenario(msg.steps, msg.name, msg.description);
      ws.close();
      process.exit(0);
    }
  } catch { /* ignore */ }
});

process.on('SIGINT', () => {
  console.log('\n\n■ 録画停止中...');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop_recording', requestId }));
  } else {
    process.exit(0);
  }
});

function saveScenario(steps, scenarioName, scenarioDesc) {
  let version = 'unknown';
  try {
    version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch { /* ignore */ }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `recorded_${timestamp}.json`;

  const scenario = {
    name: scenarioName,
    version,
    created: new Date().toISOString().slice(0, 10),
    description: scenarioDesc,
    setup: {},
    steps,
  };

  // Extract setup params from leading setup-like steps
  const setupActions = new Set(['set_gravity', 'set_damping', 'set_restitution', 'remove_all_spheres', 'clear_effects']);
  let i = 0;
  while (i < steps.length && setupActions.has(steps[i].action) && steps[i].wait < 500) {
    const s = steps[i];
    if (s.action === 'set_gravity')     scenario.setup.gravity     = s.params.y;
    if (s.action === 'set_damping')     scenario.setup.damping     = s.params.value;
    if (s.action === 'set_restitution') scenario.setup.restitution = s.params.value;
    if (s.action === 'remove_all_spheres') scenario.setup.clearSpheres = true;
    if (s.action === 'clear_effects')   scenario.setup.clearEffects = true;
    i++;
  }
  scenario.steps = steps.slice(i);

  mkdirSync('scenarios', { recursive: true });
  writeFileSync(`scenarios/${filename}`, JSON.stringify(scenario, null, 2), 'utf8');

  console.log(`\n✓ 保存しました: scenarios/${filename}`);
  console.log(`  バージョン: ${version}`);
  console.log(`  ステップ数: ${scenario.steps.length}`);
}
