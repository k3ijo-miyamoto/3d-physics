#!/usr/bin/env node
/**
 * Real-time stats logger for the 3D physics simulation.
 *
 * Usage:
 *   node log_stats.mjs [options]
 *
 * Options:
 *   --interval <ms>      Polling interval in milliseconds (default: 1000)
 *   --output <file>      CSV output path (default: stats_<timestamp>.csv)
 *   --duration <sec>     Stop after N seconds (default: run until Ctrl+C)
 *
 * Connects via WebSocket to ws://localhost:5175 (Vite bridge).
 * The simulation must be running before starting this script.
 *
 * CSV columns:
 *   elapsed_s, sphere_count, avg_speed, max_speed,
 *   total_ke, total_pe, total_energy, com_x, com_y, com_z
 */

import { createWriteStream } from 'fs';
import { WebSocket } from 'ws';

const BRIDGE_URL = 'ws://localhost:5175';

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : defaultVal;
}

const intervalMs = parseInt(getArg('--interval', '1000'), 10);
const durationSec = getArg('--duration', null);
const durationMs = durationSec ? parseFloat(durationSec) * 1000 : null;
const outputPath = getArg('--output', `stats_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);

// --- CSV setup ---
const csvStream = createWriteStream(outputPath, { flags: 'a' });
const CSV_HEADER = 'elapsed_s,sphere_count,avg_speed,max_speed,total_ke,total_pe,total_energy,com_x,com_y,com_z\n';
csvStream.write(CSV_HEADER);
console.log(`Logging to ${outputPath}  (interval=${intervalMs}ms${durationMs ? `, duration=${durationSec}s` : ''})`);

// --- WebSocket ---
let ws = null;
const pending = new Map(); // requestId → resolve

function connect() {
  ws = new WebSocket(BRIDGE_URL);

  ws.on('open', () => {
    console.log('Connected to bridge. Starting log...\n');
    startPolling();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'state_response' && msg.requestId) {
        pending.get(msg.requestId)?.(msg.state);
        pending.delete(msg.requestId);
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    console.error('\nBridge disconnected. Exiting.');
    finish();
  });

  ws.on('error', (err) => {
    console.error(`Connection error: ${err.message}`);
    finish();
  });
}

function requestState() {
  return new Promise((resolve, reject) => {
    const requestId = `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('get_state timeout'));
    }, 5000);
    pending.set(requestId, (state) => {
      clearTimeout(timer);
      resolve(state);
    });
    ws.send(JSON.stringify({ type: 'get_state', requestId }));
  });
}

// --- Polling loop ---
const startTime = Date.now();
let pollTimer = null;
let rowCount = 0;

function formatRow(state) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
  const s = state.gpuStats ?? {};
  const count = state.sphereCount ?? 0;
  const avgSpeed    = s.avgSpeed    ?? '';
  const maxSpeed    = s.maxSpeed    ?? '';
  const totalKE     = s.totalKE     ?? '';
  const totalPE     = s.totalPE     ?? '';
  const totalEnergy = s.totalEnergy ?? '';
  const [cx, cy, cz] = s.centerOfMass ?? ['', '', ''];
  return `${elapsed},${count},${avgSpeed},${maxSpeed},${totalKE},${totalPE},${totalEnergy},${cx},${cy},${cz}\n`;
}

async function poll() {
  try {
    const state = await requestState();
    const row = formatRow(state);
    csvStream.write(row);
    rowCount++;

    const s = state.gpuStats ?? {};
    process.stdout.write(
      `\r[${rowCount.toString().padStart(4)}]  ` +
      `N=${String(state.sphereCount ?? 0).padStart(7)}  ` +
      `avgV=${String(s.avgSpeed ?? '-').padEnd(7)}  ` +
      `KE=${String(s.totalKE ?? '-').padEnd(10)}  ` +
      `PE=${String(s.totalPE ?? '-').padEnd(10)}  ` +
      `E=${String(s.totalEnergy ?? '-').padEnd(10)}`
    );

    if (durationMs && Date.now() - startTime >= durationMs) {
      console.log(`\n\nDuration reached (${durationSec}s). Stopping.`);
      finish();
      return;
    }
  } catch (err) {
    console.error(`\nPoll error: ${err.message}`);
  }

  pollTimer = setTimeout(poll, intervalMs);
}

function startPolling() {
  poll();
}

function finish() {
  if (pollTimer) clearTimeout(pollTimer);
  ws?.close();
  csvStream.end(() => {
    console.log(`\n\nWrote ${rowCount} rows to ${outputPath}`);
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  console.log('\n\nInterrupted.');
  finish();
});

connect();
