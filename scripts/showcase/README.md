# Printer showcase

An original Cartesian printer for the repository cover. Dimensions are in mm.
The frame, trucks, motors, hotend, blower and mounts are solid geometry built
with OpenCascade. Belts, cables, filament and cosmetic lead-screw threads use
meshes. The source keeps each bolt and its clearance on the same axis.

From the repository root:

```sh
npm ci
node scripts/showcase/printer.mjs --step
```

Outputs go to `release/showcase/`; set `SHOWCASE_OUTPUT` to use another folder.
The `.okc` file is an imported mesh assembly. The STEP contains the solid parts;
it omits cables, belts and cosmetic threads. Edit `printer.mjs` to change the
model dimensions.

Rendering is optional and uses an extra package:

```sh
npm install --no-save --package-lock=false three-gpu-pathtracer@0.0.24
npx playwright install chromium
node scripts/showcase/render.mjs --glb
node scripts/showcase/render.mjs --trace
node scripts/showcase/cover.mjs
node scripts/showcase/pack-viewer.mjs
```

The standalone HTML viewer works offline. Drag to rotate, scroll to zoom;
the buttons jump to the toolhead and bed. `CHROMIUM_EXECUTABLE_PATH` can select
an existing Chromium installation. `SHOWCASE_DEPENDENCIES` can point to a
separate folder containing the optional renderer's `node_modules`.

Checks:

```sh
npm run build
node scripts/showcase/verify-openkitcad.mjs
node scripts/showcase/verify-step.mjs
node scripts/showcase/verify-viewer.mjs
```

The first check opens the `.okc` and reloads it from autosave. The second imports
the STEP again and checks its solid volume. The third opens the standalone
viewer offline, checks the camera buttons and validates mesh data and the GLB
container. GLB export also reloads its output and compares mesh counts and bounds.
`mechanical-audit.json` records the
bolt targets and reports clearance cutters that miss their target material.
That audit covers fastening coordinates, rather than simulating a working
printer.

The blower uses a generic 5015 layout; [Delta's BFB0512HH drawing](https://www.delta-fan.com/Download/Spec/BFB0512HH.pdf)
was used as a reference for its intake, outlet and mounting ears.
