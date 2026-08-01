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

Sketching works the way you'd hope. Drag out a rectangle and it works out that you meant the edges to be horizontal and vertical. Click an edge and type 100 and it becomes exactly 100 mm. The status bar tells you in plain English how much of your shape is still loose, instead of saying "underconstrained" and leaving you to it.

Right-click anything in a sketch and you get a short list of what you can do to it. Two lines gives you parallel, square, same length, or an angle. Two corners gives you distances. A line and a circle gives you a smooth tangent. A corner gives you the option to round it off or cut it away. You never have to know which of seventeen constraint types you wanted.

Anything still free to move is drawn in blue, and every rule you have applied shows as a small symbol you can click to remove. Between them those two answer the question that makes people give up on parametric CAD: why won't this move, or why won't it stay still.

There is trim for cleaning up lines that overshoot, and patterns for repeating geometry in a row or a ring, which is how you get a vent grille or a bolt circle without drawing sixteen identical circles by hand. Both keep the sketch fully defined afterwards.

Right-click a finished solid and you can go back and edit the outline it came from, change its thickness, round its edges, or start a new sketch directly on the face you clicked.

The catalogue covers single-board computers, microcontroller boards, ports and connectors, screws and inserts, aluminium extrusion, motors, and bearings. Every part carries its outline, its mounting holes, the volumes that need to stay clear, and where its connectors sit. Boards also carry voltage, current draw and a link to the datasheet.

From a placed part you can generate mounting holes with counterbores, printed standoffs bored for a heat-set insert, and openings cut through an enclosure wall for its ports. Round ports get round holes, which sounds obvious until you've cut a rectangle where a barrel jack was supposed to go.

Export is STL and 3MF for printing, STEP if you want to keep working in FreeCAD or Fusion, DXF and SVG for a laser cutter, and a drill template you can print at full size and tape to a project box. That last one is for anyone working with a hand drill and no machines, which is most people starting out.

There's a clash checker that uses real boolean intersections rather than bounding boxes, a section view for looking inside an enclosure, and some print checks for overhangs, bed size and thin walls.

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

Add `?selftest` to the URL on any build and it runs the solver and kernel checks in front of you. That works on the [live site](https://broiler747tb.github.io/openkitcad/?selftest) too. It's shipped on purpose: if something's broken on your machine, that page says so before you file an issue.

Pushing to `main` builds and publishes to GitHub Pages. The workflow runs `typecheck` first, so a build that doesn't compile never goes live.

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
  sketch/     constraint solver, auto-constraints, the right-click menu logic
  kernel/     OpenCascade worker: feature evaluation, profiles, exports
  catalogue/  the schema, and one JSON file per part
  doc/        document model, undo, autosave, files, share links
  viewport/   three.js scene, sketch interaction, move and turn gizmos
  export/     STL, 3MF, DXF, SVG and PDF writers
  ui/         panels, toolbar, guided tutorial
```

The geometry kernel runs in a Web Worker and owns every B-rep shape. Nothing that comes back to the main thread is anything but plain numbers. That isn't tidiness for its own sake: OpenCascade is synchronous and one boolean can take a few hundred milliseconds, which you'd feel as a stutter every time you touched a dimension box.

The constraint solver is written from scratch, in `src/sketch/solver.ts`. Levenberg-Marquardt over analytic Jacobians. Degrees of freedom come from numerically ranking the Jacobian, which is how the app can say "two things can still move" rather than showing a beginner the word underconstrained.

## What it doesn't do yet

Face and edge references are geometric fingerprints, not proper persistent names. A reference re-finds the closest matching face after a rebuild. Small parameter changes keep the right face, big ones might not. Topological naming is genuinely hard and no open source CAD has fully cracked it either.

Fillet and chamfer on a *solid* hit every edge. Per-edge picking is in the document model with no UI on top. Rounding a single corner in a *sketch* works fine.

Trim works on straight lines. Trimming an arc out of a circle is not implemented yet.

There is no engraved text, and no typing a length mid-drag while you draw. Both are on the list.

No assembly mates. Parts get positioned, not constrained to each other. That was a deliberate call, not an oversight, and it should stay that way until someone actually needs it.

If you generate standoffs somewhere the plate doesn't reach, you get floating pillars and no warning. Worth fixing.

The wall thickness warning is an estimate from volume against surface area, not a real medial-axis measurement. The app says so where it reports it.

## Licence

The app is AGPL-3.0-or-later. It's a web app, and AGPL is the one copyleft licence that actually applies to one: GPL triggers on distribution, and someone hosting a modified copy never distributes anything. Under AGPL they have to publish their changes.

The catalogue is CC0. Public domain, no strings. Measurements of physical objects ought to belong to everyone, and the data is far more useful if FreeCAD or KiCad or anyone else can take it wholesale. A catalogue becomes a standard by being copied.

OpenCascade is LGPL-2.1 with an exception, reached through [replicad](https://github.com/sgenoud/replicad) and [opencascade.js](https://github.com/donalffons/opencascade.js).
