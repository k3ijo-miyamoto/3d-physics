import GUI from 'lil-gui';

export interface SimulationParams {
  gravityY: number;
  restitution: number;
  linearDamping: number;
  sphereRadius: number;
  sphereMass: number;
  initialHeight: number;
  randomVelocity: boolean;
  speedMultiplier: number;
}

interface Callbacks {
  onAddSphere: () => void;
  onRemoveAll: () => void;
  onReset: () => void;
  onTogglePause: () => void;
  onGravityChange: (v: number) => void;
  onRestitutionChange: (v: number) => void;
  onDampingChange: (v: number) => void;
  onSphereRadiusChange: (v: number) => void;
  onExportCSV: () => void;
  getSphereCount: () => number;
  isRunning: () => boolean;
}

export class SimulationControls {
  params: SimulationParams;
  private gui: GUI;
  private sphereCountDisplay = { count: 0 };
  private statusDisplay = { status: 'Running' };
  private fixedDtDisplay = { fixedDt: '1/60 s' };

  constructor(params: SimulationParams, cb: Callbacks) {
    this.params = params;
    this.gui = new GUI({ title: 'Physics Controls', width: 280 });

    const simFolder = this.gui.addFolder('Simulation');
    simFolder.add({ toggle: () => { cb.onTogglePause(); this.updateStatus(cb.isRunning()); } }, 'toggle').name('Start / Pause');
    simFolder.add({ reset: () => cb.onReset() }, 'reset').name('Reset');
    simFolder.add(this.fixedDtDisplay, 'fixedDt').name('Fixed timestep').disable();
    simFolder.add(params, 'speedMultiplier', 0.1, 5, 0.1).name('Speed multiplier');
    simFolder.add(this.statusDisplay, 'status').name('Status').disable();

    const sphereFolder = this.gui.addFolder('Spheres');
    sphereFolder.add({ add: () => cb.onAddSphere() }, 'add').name('Add sphere');
    sphereFolder.add({ removeAll: () => cb.onRemoveAll() }, 'removeAll').name('Remove all');
    sphereFolder.add(this.sphereCountDisplay, 'count').name('Sphere count').disable();
    sphereFolder.add(params, 'sphereRadius', 0.1, 2, 0.1).name('Radius').onChange(cb.onSphereRadiusChange);
    sphereFolder.add(params, 'sphereMass', 0.1, 10, 0.1).name('Mass');
    sphereFolder.add(params, 'initialHeight', 1, 20, 0.5).name('Initial height');
    sphereFolder.add(params, 'randomVelocity').name('Random velocity');

    const physicsFolder = this.gui.addFolder('Physics');
    physicsFolder.add(params, 'gravityY', -30, 0, 0.1).name('Gravity Y').onChange(cb.onGravityChange);
    physicsFolder.add(params, 'restitution', 0, 1, 0.01).name('Restitution').onChange(cb.onRestitutionChange);
    physicsFolder.add(params, 'linearDamping', 0.9, 1, 0.001).name('Damping').onChange(cb.onDampingChange);

    const logFolder = this.gui.addFolder('Logging');
    logFolder.add({ export: () => cb.onExportCSV() }, 'export').name('Export CSV');

    simFolder.open();
    sphereFolder.open();
    physicsFolder.open();
  }

  updateSphereCount(count: number): void {
    this.sphereCountDisplay.count = count;
    this.gui.controllersRecursive().forEach((c) => {
      if (c.property === 'count') c.updateDisplay();
    });
  }

  private updateStatus(isRunning: boolean): void {
    this.statusDisplay.status = isRunning ? 'Running' : 'Paused';
    this.gui.controllersRecursive().forEach((c) => {
      if (c.property === 'status') c.updateDisplay();
    });
  }
}
