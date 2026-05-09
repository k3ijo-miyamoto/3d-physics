import type { ForceFieldSpec } from '../physics/ForceField';

type BridgeCommand =
  | { type: 'add_sphere'; height?: number }
  | { type: 'add_spheres_bulk'; count: number }
  | { type: 'remove_all_spheres' }
  | { type: 'reset_simulation' }
  | { type: 'pause_simulation' }
  | { type: 'resume_simulation' }
  | { type: 'set_gravity'; y: number }
  | { type: 'set_restitution'; value: number }
  | { type: 'set_damping'; value: number }
  | { type: 'apply_force_field'; field: ForceFieldSpec }
  | { type: 'clear_effects' }
  | { type: 'remove_walls' }
  | { type: 'set_sphere_radius'; value: number }
  | { type: 'get_state'; requestId: string }
  | { type: 'start_auto_explosion' }
  | { type: 'stop_auto_explosion' }
  | { type: 'set_attractors'; points: Array<{ x: number; y: number; z: number; strength: number }> };

export interface BridgeHandlers {
  addSphere(height?: number): void;
  addSpheresBulk(count: number): void;
  removeAllSpheres(): void;
  reset(): void;
  pause(): void;
  resume(): void;
  setGravity(y: number): void;
  setRestitution(value: number): void;
  setDamping(value: number): void;
  applyForceField(spec: ForceFieldSpec): void;
  clearEffects(): void;
  removeWalls(): void;
  setSphereRadius(value: number): void;
  getState(): object;
  startAutoExplosion(): void;
  stopAutoExplosion(): void;
  setAttractors(points: Array<{ x: number; y: number; z: number; strength: number }>): void;
  onConnectionChange(connected: boolean): void;
}

const WS_URL = 'ws://localhost:5175';
const RECONNECT_DELAY_MS = 3000;

export class SimulationBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private handlers: BridgeHandlers) {
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.handlers.onConnectionChange(true);
      };

      this.ws.onmessage = (event: MessageEvent<string>) => {
        try {
          this.dispatch(JSON.parse(event.data) as BridgeCommand);
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.handlers.onConnectionChange(false);
        if (!this.disposed) {
          this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
        }
      };

      this.ws.onerror = () => {
        // onclose fires after onerror, so reconnect logic is there
      };
    } catch {
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    }
  }

  private dispatch(cmd: BridgeCommand): void {
    switch (cmd.type) {
      case 'add_sphere':         this.handlers.addSphere(cmd.height); break;
      case 'add_spheres_bulk':   this.handlers.addSpheresBulk(cmd.count); break;
      case 'remove_all_spheres': this.handlers.removeAllSpheres(); break;
      case 'reset_simulation':   this.handlers.reset(); break;
      case 'pause_simulation':   this.handlers.pause(); break;
      case 'resume_simulation':  this.handlers.resume(); break;
      case 'set_gravity':        this.handlers.setGravity(cmd.y); break;
      case 'set_restitution':    this.handlers.setRestitution(cmd.value); break;
      case 'set_damping':        this.handlers.setDamping(cmd.value); break;
      case 'apply_force_field':  this.handlers.applyForceField(cmd.field); break;
      case 'clear_effects':      this.handlers.clearEffects(); break;
      case 'remove_walls':       this.handlers.removeWalls(); break;
      case 'set_sphere_radius':    this.handlers.setSphereRadius(cmd.value); break;
      case 'start_auto_explosion': this.handlers.startAutoExplosion(); break;
      case 'stop_auto_explosion':  this.handlers.stopAutoExplosion(); break;
      case 'set_attractors':       this.handlers.setAttractors(cmd.points); break;
      case 'get_state': {
        const state = this.handlers.getState();
        this.send({ type: 'state_response', requestId: cmd.requestId, state });
        break;
      }
    }
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
