# CLAUDE.md

## Project Title

3D Rigid Body Physics Simulation MVP

## Goal

Build a small 3D physics simulation system from scratch using **Three.js + TypeScript**.

The first target is not to use a built-in physics engine such as Cannon.js, Ammo.js, Rapier, Unity Physics, or PhysX.  
The purpose is to implement and understand the core physics loop ourselves.

The MVP should simulate:

1. A sphere falling under gravity.
2. Collision with a floor plane.
3. Bounce based on restitution.
4. Energy loss through damping.
5. Multiple spheres.
6. Sphere-vs-sphere collision.
7. Basic UI controls for parameters.

This project is both a physics simulation prototype and a foundation for future AI-assisted simulation experiments.

---

## Core Design Philosophy

This system should be designed as a minimal but extensible physics engine.

The project should clearly separate:

- physics state
- collision detection
- collision resolution
- rendering
- user interface
- experiment logging

Rendering should visualize the simulation, but the renderer must not own the physics logic.

The physics engine should be deterministic as much as possible when given the same initial conditions and fixed timestep.

---

## Recommended Tech Stack

### Required

- TypeScript
- Vite
- Three.js

### Optional

- lil-gui or dat.GUI for parameter controls
- Vitest for unit tests
- ESLint / Prettier

### Do Not Use Initially

Do not use these libraries for physics calculation in the MVP:

- Cannon.js
- Ammo.js
- Rapier
- Matter.js
- PhysX
- Unity Physics

They may be used later only as comparison references.

---

## Target Directory Structure

```text
physics-sim/
├── CLAUDE.md
├── package.json
├── index.html
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.ts
    ├── app/
    │   └── SimulationApp.ts
    ├── physics/
    │   ├── PhysicsWorld.ts
    │   ├── RigidBody.ts
    │   ├── Vector3Utils.ts
    │   ├── Integrator.ts
    │   ├── CollisionDetection.ts
    │   ├── CollisionResolution.ts
    │   ├── CollisionManifold.ts
    │   └── colliders/
    │       ├── Collider.ts
    │       ├── SphereCollider.ts
    │       └── PlaneCollider.ts
    ├── rendering/
    │   ├── Renderer3D.ts
    │   └── ObjectFactory.ts
    ├── ui/
    │   └── SimulationControls.ts
    └── logging/
        └── SimulationLogger.ts
```

---

## MVP Features

### Phase 1: Single Sphere Falling

Implement a single sphere affected by gravity.

Required behavior:

- Sphere starts above the floor.
- Gravity accelerates the sphere downward.
- Sphere position updates over time.
- Sphere visually moves in 3D.
- Camera, light, grid, and floor are visible.

Physics formula:

```text
acceleration = force / mass
velocity = velocity + acceleration * dt
position = position + velocity * dt
```

For gravity:

```text
velocity.y += gravity * dt
position += velocity * dt
```

Default gravity:

```text
gravity = -9.81
```

---

### Phase 2: Floor Collision

Implement collision between a sphere and a horizontal plane.

Floor plane:

```text
y = 0
```

Sphere collision condition:

```text
if sphere.position.y - sphere.radius < 0:
    collision detected
```

Correction:

```text
sphere.position.y = sphere.radius
```

Velocity response:

```text
sphere.velocity.y = -sphere.velocity.y * restitution
```

Default restitution:

```text
restitution = 0.7
```

---

### Phase 3: Damping

Add damping to gradually reduce velocity.

Example:

```text
velocity *= dampingFactor
```

Recommended default:

```text
linearDamping = 0.995
```

Damping should be applied per physics step, not per rendered frame if fixed timestep is used.

---

### Phase 4: Multiple Spheres

Add support for multiple rigid bodies.

Each sphere should have:

- unique id
- position
- velocity
- mass
- inverseMass
- radius
- restitution
- linearDamping
- collider
- mesh reference or render id

The physics engine should not directly depend on Three.js Mesh objects.

---

### Phase 5: Sphere-vs-Sphere Collision

Collision condition:

```text
distance(centerA, centerB) < radiusA + radiusB
```

Collision normal:

```text
normal = normalize(centerB - centerA)
```

Penetration depth:

```text
penetration = radiusA + radiusB - distance
```

Position correction:

```text
totalInverseMass = invMassA + invMassB

bodyA.position -= normal * penetration * (invMassA / totalInverseMass)
bodyB.position += normal * penetration * (invMassB / totalInverseMass)
```

Relative velocity:

```text
relativeVelocity = velocityB - velocityA
velocityAlongNormal = dot(relativeVelocity, normal)
```

If `velocityAlongNormal > 0`, objects are separating and no impulse should be applied.

Impulse scalar:

```text
j = -(1 + restitution) * velocityAlongNormal
j /= invMassA + invMassB
```

Impulse application:

```text
impulse = j * normal
velocityA -= impulse * invMassA
velocityB += impulse * invMassB
```

Use the lower restitution of the two bodies:

```text
restitution = min(restitutionA, restitutionB)
```

---

## Physics Engine Requirements

### RigidBody

The `RigidBody` class should include:

```ts
type RigidBodyType = "dynamic" | "static";

class RigidBody {
  id: string;
  type: RigidBodyType;

  position: THREE.Vector3;
  velocity: THREE.Vector3;
  forceAccum: THREE.Vector3;

  mass: number;
  inverseMass: number;

  restitution: number;
  linearDamping: number;

  collider: Collider;
}
```

Rules:

- Dynamic bodies move.
- Static bodies do not move.
- Static bodies should have `inverseMass = 0`.
- Mass must be positive for dynamic bodies.

---

### Collider

Base collider:

```ts
type ColliderType = "sphere" | "plane";

interface Collider {
  type: ColliderType;
}
```

Sphere collider:

```ts
class SphereCollider implements Collider {
  type = "sphere";
  radius: number;
}
```

Plane collider:

```ts
class PlaneCollider implements Collider {
  type = "plane";
  normal: THREE.Vector3;
  offset: number;
}
```

For the MVP, the floor plane can be represented as:

```text
normal = (0, 1, 0)
offset = 0
```

---

### PhysicsWorld

The `PhysicsWorld` class should manage:

- list of rigid bodies
- gravity
- fixed timestep
- stepping the simulation
- collision detection
- collision resolution

Required API:

```ts
class PhysicsWorld {
  bodies: RigidBody[];
  gravity: THREE.Vector3;
  fixedDt: number;

  addBody(body: RigidBody): void;
  removeBody(id: string): void;
  step(dt: number): void;
  reset(): void;
}
```

Recommended simulation loop:

```text
accumulator += frameDt

while accumulator >= fixedDt:
    physicsWorld.step(fixedDt)
    accumulator -= fixedDt

render()
```

Recommended fixed timestep:

```text
fixedDt = 1 / 60
```

---

## Rendering Requirements

Use Three.js to render:

- Perspective camera
- OrbitControls
- Directional light
- Ambient light
- Grid helper
- Floor plane
- Spheres

The rendering layer should synchronize mesh positions from physics body positions.

Required behavior:

```text
for each body:
    mesh.position.copy(body.position)
```

Physics should not be calculated inside the rendering layer.

---

## UI Requirements

Add a parameter panel.

Required controls:

- start / pause
- reset
- add sphere
- remove all spheres
- gravity
- restitution
- damping
- sphere count
- random initial velocity
- fixed timestep display
- simulation speed multiplier

Recommended default values:

```text
gravityY = -9.81
restitution = 0.7
linearDamping = 0.995
sphereRadius = 0.5
sphereMass = 1.0
initialHeight = 5.0
```

---

## Logging Requirements

Add basic logging for experiments.

At minimum, log per simulation step:

- time
- body id
- position x/y/z
- velocity x/y/z
- kinetic energy
- potential energy
- total energy

Formulas:

```text
kineticEnergy = 0.5 * mass * speed^2
potentialEnergy = mass * abs(gravity.y) * height
totalEnergy = kineticEnergy + potentialEnergy
```

For the first MVP, console logging is acceptable.

Later, implement CSV export.

---

## Acceptance Criteria

The MVP is complete when:

1. The app starts with a visible 3D scene.
2. A sphere falls under gravity.
3. The sphere collides with the floor and bounces.
4. The bounce height decreases over time due to damping.
5. Multiple spheres can be added.
6. Spheres collide with each other.
7. The simulation can be paused and reset.
8. Parameters can be changed from the UI.
9. Physics logic is separated from rendering logic.
10. The system runs in the browser using Vite.

---

## Implementation Order

Follow this order strictly:

1. Create Vite + TypeScript + Three.js project.
2. Build basic 3D scene.
3. Add one sphere and floor.
4. Implement `RigidBody`.
5. Implement gravity integration.
6. Implement sphere-plane collision.
7. Add restitution.
8. Add damping.
9. Add `PhysicsWorld`.
10. Add multiple spheres.
11. Implement sphere-sphere collision.
12. Add UI controls.
13. Add basic logging.
14. Clean up code structure.
15. Add small unit tests for collision math.

---

## Suggested Commands

```bash
npm create vite@latest physics-sim -- --template vanilla-ts
cd physics-sim
npm install
npm install three
npm install -D @types/three
npm install lil-gui
npm run dev
```

---

## Initial Test Scenarios

### Test 1: Free Fall

Initial state:

```text
position = (0, 5, 0)
velocity = (0, 0, 0)
gravity = (0, -9.81, 0)
```

Expected:

- y position decreases over time.
- downward velocity increases.

---

### Test 2: Floor Bounce

Initial state:

```text
position = (0, 1, 0)
velocity = (0, -5, 0)
radius = 0.5
restitution = 0.8
```

Expected:

- sphere does not pass through floor.
- velocity.y becomes positive after collision.
- bounce speed is smaller than impact speed.

---

### Test 3: No Bounce

Initial state:

```text
restitution = 0.0
```

Expected:

- sphere hits the floor and does not bounce significantly.
- small jitter should be avoided.

---

### Test 4: Sphere-Sphere Collision

Initial state:

```text
sphereA.position = (-1, 1, 0)
sphereA.velocity = (1, 0, 0)

sphereB.position = (1, 1, 0)
sphereB.velocity = (-1, 0, 0)

radiusA = radiusB = 0.5
massA = massB = 1.0
restitution = 1.0
```

Expected:

- spheres collide.
- velocities are exchanged approximately.

---

## Known Limitations in MVP

The first version does not need to support:

- box collider
- rotation
- angular velocity
- torque
- friction
- sleeping
- continuous collision detection
- mesh collision
- soft body simulation
- FEM
- GPU acceleration
- constraint solver
- joints
- stacking stability

These can be added later.

---

## Future Extension Roadmap

### Stage 2: Better Rigid Body Physics

Add:

- box collider
- AABB broad phase
- friction
- angular velocity
- inertia tensor
- torque
- impulse with rotational effects
- contact manifold
- sleeping objects

### Stage 3: Experiment System

Add:

- scenario presets
- JSON config import/export
- CSV logging
- graph visualization
- energy conservation checks
- simulation replay

### Stage 4: AI Integration

Add natural language instruction support.

Example:

```text
Create a simulation with 10 spheres, gravity -9.81, restitution 0.5, and compare energy loss over 20 seconds.
```

Expected AI behavior:

1. Parse the instruction.
2. Generate simulation config.
3. Run the simulation.
4. Log results.
5. Summarize behavior.
6. Export graph or CSV.

### Stage 5: MCP Integration

Expose simulation operations as MCP tools.

Possible MCP tools:

```text
create_simulation
add_sphere
set_gravity
set_restitution
run_simulation
pause_simulation
reset_simulation
export_log
compare_runs
```

This would allow LLM agents to control physics simulation experiments through structured tool calls.

---

## Important Engineering Notes

- Use fixed timestep for physics.
- Avoid tying physics behavior to render frame rate.
- Keep physics objects independent from Three.js Mesh.
- Use clear naming.
- Prefer simple readable math over premature optimization.
- Add comments around collision resolution math.
- Start with correctness, then improve stability.
- Avoid adding too many features before the MVP works.
- Do not introduce third-party physics engines before the custom MVP is complete.

---

## Definition of Done

The project is considered done for the first milestone when a user can open the browser and:

1. See a 3D simulation scene.
2. Add several spheres.
3. Watch them fall, bounce, and collide.
4. Change gravity, restitution, and damping.
5. Pause and reset the simulation.
6. Confirm that the physics code is implemented manually, not delegated to an external physics engine.

