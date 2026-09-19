# OpenKitCAD

Parametric CAD for people who build things on a bench. It runs in a browser, it's free, and it knows where the holes go.

**[Try it here.](https://broiler747tb.github.io/openkitcad/)** Nothing to install.

It costs nothing and always will. If it earns its keep, [there's a hat](#support).

There's no server involved. Your design stays on your machine, and the first load pulls an 11 MB WebAssembly build of the geometry kernel, so give it a few seconds on a slow connection. After that it's cached and works offline.

## Why

I got tired of the same twenty minutes. You want a plate to bolt a Raspberry Pi to. The modelling is trivial: a rectangle, three millimetres thick, four holes. The annoying part is finding out that the holes are 58 mm apart one way and 49 the other, sitting 3.5 mm in from each edge, and that they want M2.5 screws. Then you type those numbers in and hope you didn't fat-finger a decimal.

Tinkercad won't hold a dimension. FreeCAD and Fusion will, but they'll teach you what a datum plane is first, and you just wanted a plate.

So the modelling here is real parametric CAD, and the catalogue does the remembering. Drop a Pi on your plate, press one button, and the holes appear in the right places with the right counterbores. Move the Pi and the holes move with it.

## What it does

Sketching works the way you'd hope. Drag out a rectangle and it works out that you meant the edges to be horizontal and vertical. Type a size while you're still dragging and it's that size when you let go. Click an edge and type 100 and it becomes exactly 100 mm. The status bar tells you in plain English how much of your shape is still loose, instead of saying "underconstrained" and leaving you to it.

Right-click anything in a sketch and you get a short list of what you can do to it. Two lines gives you parallel, square, same length, or an angle. Two corners gives you distances. A line and a circle gives you a smooth tangent. A corner gives you the option to round it off or cut it away. You never have to know which of seventeen constraint types you wanted.

Anything still free to move is drawn in blue, and every rule you have applied shows as a small symbol you can click to remove. Between them those two answer the question that makes people give up on parametric CAD: why won't this move, or why won't it stay still.

There is trim for cleaning up lines that overshoot, including cutting an arc out of a circle, and patterns for repeating geometry in a row or a ring, which is how you get a vent grille or a bolt circle without drawing sixteen identical circles by hand. Both keep the sketch fully defined afterwards.

The modelling tools are Fusion's, under Fusion's names, with one plain-English hint on each. Extrude, Revolve, Sweep, Loft, Coil, Pipe, Hole and Press Pull. Fillet, Chamfer, Shell, Draft, Offset Face, Move, Combine, Pattern, Mirror, Split and Scale. A SURFACE tab for open faces that you thicken or stitch into a solid, and a MESH tab for triangle meshes you import, cut, reduce, remesh, smooth and convert back into solids. Every command opens a panel at the top right with a live preview and arrows you can drag, so you see the answer before you commit to it.

Everything you do lands on one timeline along the bottom. Drag the marker back to watch the model come apart, drop a new step into the middle, reorder steps, group them, or double-click any step to change what you typed. A step that can't find the face it was built on says so on the timeline rather than quietly picking a different one.

You can make components, copy one as a link so every copy changes together, and joint parts to each other: rigid, revolute, slider, cylindrical, pin-slot, planar and ball. Drive a joint by angle or distance, give it limits, drag it and watch it move the way the real thing would, and record a motion study to play back.

The catalogue is 125 parts: single-board computers, microcontroller boards, displays, sensors, power modules, motor drivers, connectors and ports, pots and encoders, motors, bearings, screws and heat-set inserts, and aluminium extrusion. Every part carries its outline, its mounting holes, the volumes that need to stay clear, and where its connectors sit. Boards also carry voltage, current draw and a link to the datasheet. Most are pinned to a real, named product with a published drawing, and every one says how sure it is — 86 from datasheets, one measured, 38 approximate — and the app shows you which before you build around it.

From a placed part you can generate mounting holes with counterbores, printed standoffs bored for a heat-set insert, clips that hold a board down without screws, and openings cut through an enclosure wall for its ports. Or right-click the part and choose Enclosure and you get the whole box at once: walls, corner towers, a lid, the mounts and every opening you ticked. Round ports get round holes, which sounds obvious until you've cut a rectangle where a barrel jack was supposed to go.

For printing there are seven fits, each placed by clicking a face: snap fit, alignment pins, lip and groove, dovetail, snap ring, bayonet, and a print-in-place hinge. Print the fit coupon once to find out what your printer really leaves, then type that number into the fit classes in the design's parameters and every fit after it comes out right. Ribs and webs brace a thin wall, a screw lid closes a round opening, and four kinds of cable entry get a lead out of a box.

Text uses the fonts on your own computer, kept in the design as letter shapes so it travels with the file, and Emboss raises or sinks it on a flat face or round the side of a cylinder.

If you designed the board yourself, File > Import KiCad Board reads a `.kicad_pcb`, takes the outline and the mounting holes off Edge.Cuts, asks you which footprints are connectors and how tall things are, and saves the result with your own parts. From there it places, clips, gets standoffs and goes in an enclosure like any shipped board.

Export is STL, 3MF and OBJ for printing and rendering, STEP if you want to keep working in FreeCAD or Fusion, DXF and SVG for a laser cutter, and a drill template you can print at full size and tape to a project box. That last one is for anyone working with a hand drill and no machines, which is most people starting out.

There's a clash checker that uses real boolean intersections rather than bounding boxes, a section view for looking inside an enclosure, and some print checks for overhangs, bed size and thin walls. If a step joins something on and it lands where there was nothing to join it to, the timeline says so rather than leaving you a floating pillar to find in the slicer. Light and dark themes, a view cube, a marking menu under the right mouse button, and the mouse scheme from Fusion, SolidWorks, Onshape or Tinkercad if your hands already know one of those.

On a laptop there is a Touchpad scheme, because every other one wants a middle button and a touchpad hasn't got one. Two fingers pan, pinch zooms, and Alt with two fingers orbits. A wheel still zooms if you plug a mouse in, so docking doesn't take the scroll wheel away from you.

## Support

OpenKitCAD is free and there is nothing to upgrade to. No trial, no seats, and
no licence server to phone home on the morning you actually need it.

If it saved you an afternoon, the going rate is a metre of filament.

| Network | Address |
| --- | --- |
| TON | `UQBZwupG-6KNVW9gpBUWfD-yTcBj2x9TnlP_xBbje_qblyaO` |
| Ethereum | `0x813EB4EaC25e28d60C21af26E432b98E13D79980` |
| Solana | `3LbwCtvxRQqQEmQk44byY3wpYsnZUf832jwoCZRrg3dh` |

TON and Solana are the sensible ones for small amounts, where a transfer costs a
fraction of a cent. An Ethereum mainnet transfer can cost more than you meant to
send, which would be a shame for both of us.

Check the address against this page before sending, and send a small amount
first if it's an amount you'd miss. None of it is reversible and nobody can undo
it for you.

Nothing in the app is behind this and nothing is planned to be. The catalogue
stays CC0 either way: it becomes a standard by being copied, not by being sold.

## Running it

```
npm install
npm run dev
```

First load pulls an 11 MB WebAssembly build of OpenCascade. It's cached after that.

```
npm run build
npm run typecheck
```

Add `?selftest` to the URL on any build and it runs all 1047 solver, kernel and model checks in front of you. That works on the [live site](https://broiler747tb.github.io/openkitcad/?selftest) too. It's shipped on purpose: if something's broken on your machine, that page says so before you file an issue. `?kerneltest` runs the geometry half on its own, and `?selftest&suite=sketch,kernel` runs named suites.

```
npm test
```

runs the same 1047 checks headlessly, against a production build, in Chromium. It uses Playwright's own browser if you have run `npx playwright install chromium`, and falls back to an installed Edge or Chrome if you haven't.

Pushing to `main` builds and publishes to GitHub Pages. The workflow runs `typecheck` and then `npm test`, so a build that doesn't compile, or that fails a single check, never goes live.

## Adding a part

This is the most useful thing you can contribute and it doesn't need any CAD knowledge. A caliper and fifteen minutes.

Drop one JSON file into `src/catalogue/parts/`. The schema lives in `src/catalogue/types.ts`. `bearing-608zz.json` is about the shortest useful example and `raspberry-pi-4b.json` is the fullest.

Four things matter:

Origin is the lower-left corner of the part's outline, Z up. Datasheets dimension holes that way, so the numbers copy straight over.

Millimetres. Always.

Set `confidence` honestly. Use `datasheet` if it came off an official drawing, `measured` if you measured a real one with calipers, and `approximate` for anything else. When you're not sure, it's approximate. That's not a failure, it's the honest answer, and the app shows it to whoever uses your part.

Say in `source` what you *didn't* verify. Something like "outline is from the official drawing, connector positions are eyeballed to about a millimetre" is genuinely useful to the next person. A catalogue that quietly mixes checked numbers with guesses is worse than no catalogue at all, because someone cuts a panel and finds out the hard way.

Geometry is generated from the JSON, so a part works the moment the numbers are right. Prettier models are optional and never drive dimensions.

## How it's built

```
src/
  sketch/     constraint solver, auto-constraints, sketch tools, text
  kernel/     OpenCascade worker: feature evaluation, element map, exports
  doc/        document model, timeline, undo, autosave, files, share links
  assembly/   components, joints, the joint solver, motion studies
  mesh/       triangle meshes: import, cut, reduce, remesh, repair, convert
  catalogue/  the schema, one JSON file per part, the KiCad importer
  viewport/   three.js scene, sketch interaction, manipulators, part looks
  export/     STL, 3MF, OBJ, DXF, SVG and PDF writers
  ui/         ribbon, command panel, timeline, browser, panels, icons
  core/       units, quantities, number formatting, plain-English wording
  theme/      light and dark on one token set
  dev/        the suites behind ?selftest
```

The geometry kernel runs in a Web Worker and owns every B-rep shape. Nothing that comes back to the main thread is anything but plain numbers. That isn't tidiness for its own sake: OpenCascade is synchronous and one boolean can take a few hundred milliseconds, which you'd feel as a stutter every time you touched a dimension box.

Faces and edges are referenced by a persistent element map, not by where they happen to sit in space. Every operation records what it made and what it derived that from, so a reference survives the model changing shape underneath it. When one genuinely can't be resolved, the timeline shows an error on that step rather than guessing at the nearest face and building the wrong thing.

The constraint solver is written from scratch, in `src/sketch/solver.ts`. Levenberg-Marquardt over analytic Jacobians. Degrees of freedom come from numerically ranking the Jacobian, which is how the app can say "two things can still move" rather than showing a beginner the word underconstrained.

Designs are version 2. Files written by 0.6 and earlier are refused on open rather than half-converted.

## What it doesn't do yet

The wall thickness warning is an estimate from volume against surface area, not a real medial-axis measurement. The app says so where it reports it.

Delete Face, Replace Face, non-uniform scale and IGES are out, because the bundled OpenCascade build doesn't carry them. Split is built out of booleans instead.

There is no sheet metal, no drawings or dimensioned sheets, no simulation, no CAM, and no generative design.

Nothing is stored anywhere but your machine, which also means there is no version history to go back through and no way for two people to work on a design at once.

## Licence

The app is AGPL-3.0-or-later. It's a web app, and AGPL is the one copyleft licence that actually applies to one: GPL triggers on distribution, and someone hosting a modified copy never distributes anything. Under AGPL they have to publish their changes.

The catalogue is CC0. Public domain, no strings. Measurements of physical objects ought to belong to everyone, and the data is far more useful if FreeCAD or KiCad or anyone else can take it wholesale. A catalogue becomes a standard by being copied.

OpenCascade is LGPL-2.1 with an exception, reached through [replicad](https://github.com/sgenoud/replicad) and [opencascade.js](https://github.com/donalffons/opencascade.js).
