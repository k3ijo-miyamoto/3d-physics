import { defineConfig } from 'vitest/config';
import { WebSocketServer, WebSocket as WS } from 'ws';
import type { Plugin } from 'vite';

/**
 * WebSocket relay bridge for the physics control panel.
 * Runs alongside the Vite dev server (always up while `npm run dev` is running).
 * Both the browser and the MCP server connect here as clients;
 * messages are relayed to all other connected clients.
 */
function physicsControlBridge(): Plugin {
  return {
    name: 'physics-control-bridge',
    configureServer() {
      const clients = new Set<WS>();

      const wss = new WebSocketServer({ port: 5175 });

      wss.on('listening', () => {
        console.log('\n  \x1b[36m[physics-bridge]\x1b[0m Control bridge: \x1b[4mws://localhost:5175\x1b[0m\n');
      });

      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error('[physics-bridge] Port 5175 already in use — bridge not started');
        }
      });

      wss.on('connection', (ws: WS) => {
        clients.add(ws);

        ws.on('close', () => clients.delete(ws));

        // Relay every message to all other connected clients
        ws.on('message', (data: Buffer) => {
          const msg = data.toString();
          for (const client of clients) {
            if (client !== ws && client.readyState === WS.OPEN) {
              client.send(msg);
            }
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [physicsControlBridge()],
  test: {
    environment: 'node',
  },
});
