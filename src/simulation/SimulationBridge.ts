import type { ForceFieldSpec } from '../physics/ForceField';

type BridgeCommand =
  | { type: 'add_sphere'; height?: number }
  | { type: 'add_spheres_bulk'; count: number; height?: number }
  | { type: 'remove_all_spheres' }
  | { type: 'remove_spheres'; count: number }
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
  | { type: 'set_attractors'; points: Array<{ x: number; y: number; z: number; strength: number }> }
  | { type: 'start_spiral_attractors'; centers: Array<{ x: number; y: number; z: number }>; r?: number; omega?: number; strength?: number }
  | { type: 'stop_spiral_attractors' }
  | { type: 'add_spheres_shell'; count: number; radius?: number; thickness?: number }
  | { type: 'start_recording'; name?: string; description?: string }
  | { type: 'stop_recording'; requestId: string }
  | { type: 'set_attractor_slot'; index: number; x: number; y: number; z: number; strength: number };

export interface BridgeHandlers {
  addSphere(height?: number): void;
  addSpheresBulk(count: number, height?: number): void;
  removeAllSpheres(): void;
  removeSpheres(count: number): void;
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
  getState(): Promise<object>;
  startAutoExplosion(): void;
  stopAutoExplosion(): void;
  setAttractors(points: Array<{ x: number; y: number; z: number; strength: number }>): void;
  startSpiralAttractors(centers: Array<{ x: number; y: number; z: number }>, r?: number, omega?: number, strength?: number): void;
  stopSpiralAttractors(): void;
  addSpheresShell(count: number, radius: number, thickness: number): void;
  setAttractorSlot(index: number, x: number, y: number, z: number, strength: number): void;
  onConnectionChange(connected: boolean): void;
}

const WS_URL = 'ws://localhost:5175';
const RECONNECT_DELAY_MS = 3000;

type RecordedStep = { action: string; params: Record<string, unknown>; wait: number };

export class SimulationBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private recording: RecordedStep[] | null = null;
  private recordingStart = 0;
  private recordingName = '';
  private recordingDescription = '';
  private lastStepTime = 0;

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
        this.dispatch(JSON.parse(event.data) as BridgeCommand).catch(() => {});
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

  private record(action: string, params: Record<string, unknown>): void {
    if (!this.recording) return;
    const now = Date.now();
    const wait = this.recording.length === 0 ? 0 : now - this.lastStepTime;
    this.lastStepTime = now;
    this.recording.push({ action, params, wait });
  }

  private async dispatch(cmd: BridgeCommand): Promise<void> {
    // Recording control — do not record these meta-commands
    if (cmd.type === 'start_recording') {
      this.recording = [];
      this.recordingStart = Date.now();
      this.lastStepTime = Date.now();
      this.recordingName = cmd.name ?? 'recorded';
      this.recordingDescription = cmd.description ?? '';
      return;
    }
    if (cmd.type === 'stop_recording') {
      const steps = this.recording ?? [];
      this.recording = null;
      this.send({ type: 'recording_response', requestId: cmd.requestId, steps, name: this.recordingName, description: this.recordingDescription });
      return;
    }

    // Capture command before dispatching
    this.captureForRecording(cmd);

    switch (cmd.type) {
      case 'add_sphere':         this.handlers.addSphere(cmd.height); break;
      case 'add_spheres_bulk':   this.handlers.addSpheresBulk(cmd.count, cmd.height); break;
      case 'remove_all_spheres': this.handlers.removeAllSpheres(); break;
      case 'remove_spheres':     this.handlers.removeSpheres(cmd.count); break;
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
      case 'set_attractors':          this.handlers.setAttractors(cmd.points); break;
      case 'start_spiral_attractors': this.handlers.startSpiralAttractors(cmd.centers, cmd.r, cmd.omega, cmd.strength); break;
      case 'stop_spiral_attractors':  this.handlers.stopSpiralAttractors(); break;
      case 'add_spheres_shell':        this.handlers.addSpheresShell(cmd.count, cmd.radius ?? 120, cmd.thickness ?? 5); break;
      case 'set_attractor_slot':       this.handlers.setAttractorSlot(cmd.index, cmd.x, cmd.y, cmd.z, cmd.strength); break;
      case 'get_state': {
        const state = await this.handlers.getState();
        this.send({ type: 'state_response', requestId: cmd.requestId, state });
        break;
      }
    }
  }

  private captureForRecording(cmd: BridgeCommand): void {
    if (!this.recording) return;
    const now = Date.now();
    const wait = this.recording.length === 0 ? 0 : now - this.lastStepTime;
    this.lastStepTime = now;
    let action = cmd.type;
    let params: Record<string, unknown> = {};

    if (cmd.type === 'add_sphere')          params = { height: cmd.height };
    else if (cmd.type === 'add_spheres_bulk') params = { count: cmd.count, height: cmd.height };
    else if (cmd.type === 'add_spheres_shell') params = { count: cmd.count, radius: cmd.radius, thickness: cmd.thickness };
    else if (cmd.type === 'remove_spheres') params = { count: cmd.count };
    else if (cmd.type === 'set_gravity')    params = { y: cmd.y };
    else if (cmd.type === 'set_restitution') params = { value: cmd.value };
    else if (cmd.type === 'set_damping')    params = { value: cmd.value };
    else if (cmd.type === 'apply_force_field') { action = `apply_${cmd.field.type}`; params = cmd.field as unknown as Record<string, unknown>; }
    else if (cmd.type === 'set_attractors') params = { points: cmd.points };
    else if (cmd.type === 'start_spiral_attractors') params = { centers: cmd.centers, r: cmd.r, omega: cmd.omega, strength: cmd.strength };
    else if (cmd.type === 'set_sphere_radius') params = { value: cmd.value };
    else if (cmd.type === 'set_attractor_slot') params = { index: cmd.index, x: cmd.x, y: cmd.y, z: cmd.z, strength: cmd.strength };

    this.recording.push({ action, params, wait });
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
