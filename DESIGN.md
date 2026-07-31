# OpenKitCAD — design

The decisions, and why. Written so that someone picking this up in a year can tell which
choices were considered and which were accidents.

---

## 1. What this is for

A tinkerer has a Raspberry Pi and wants a plate to bolt it to, an enclosure around it, or
a bracket to hang it off some 2020 extrusion. Today that means either Tinkercad (which
cannot hold a dimension) or FreeCAD/Fusion (which will teach them the word *datum plane*
before they get a hole in the right place).

The gap is not modelling power. It is that **nobody knows where the holes go**, and
looking it up, transcribing it and not fat-fingering a decimal is most of the work.

So: real parametric CAD, but the catalogue does the remembering.

**Audience: a total CAD beginner.** That sets the vocabulary everywhere — "Round edges",
not "Fillet"; "2 things can still move", not "underconstrained"; "Make solid", not
"Extrude". The power is not reduced, only the jargon.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | Browser, static site | Zero install, instant catalogue updates, a share link needs no host. Works offline once cached. |
| Modelling | Full parametric B-rep | STEP export was required, and STEP means a real kernel. Mesh CSG could not have delivered it. |
| Kernel | OpenCascade via WASM (replicad) | The only credible browser B-rep with STEP in and out. |
| Solver | Written from scratch | See §4. |
| Storage | Local-first, no server | No account, no bill, no privacy policy, no ongoing obligation for a free tool. |
| Assemblies | One document, many bodies | A separate assembly mode is the single biggest source of confusion for new CAD users, and 95% of tinkerer projects do not need mates. |
| Sharing | File + URL-fragment link | The fragment is never sent to a server, so sharing is private by construction and costs nothing to run. |
| Licence | AGPL app, CC0 catalogue | See §7. |
| Theme | Dark studio, amber accent | Long sessions; and every other CAD is blue, so screenshots are recognisable. |

## 3. Architecture

Two threads, with a hard line between them.

**The worker owns all geometry.** Every B-rep shape lives there. OpenCascade is
synchronous and a single boolean or fillet can take hundreds of milliseconds, so running
it on the main thread would stutter the viewport on every keystroke in a dimension box.
Nothing crosses back but typed arrays and plain numbers.

That line is load-bearing, and it bit during development: the toolbar called
`sketchToProfile` to decide whether to enable "Make solid", which builds replicad
geometry — on a thread where OpenCascade does not exist. It threw on every render.
The fix was to split the *pure* loop analysis (`sketchLoopSummary`) from the geometry
construction. Anything the UI needs to know about a sketch must be computable without
the kernel.

**Rebuilds are whole-document and coalesced.** For models of this size a full rebuild is
tens of milliseconds, far cheaper than the bug class a partial-invalidation cache
introduces. Requests arriving during a build replace each other, so the kernel always
works on the newest document.

## 4. The constraint solver

Written from scratch rather than binding FreeCAD's planegcs.

The reasoning: the constraint vocabulary here is deliberately small (17 kinds), all of
which have easy analytic Jacobians; sketches are tens of entities, so a dense solve is
sub-millisecond; and controlling it outright means the failure messages can be written
for beginners instead of translated from a solver's internal vocabulary. A second WASM
dependency with a thin API was the larger risk.

Levenberg-Marquardt over analytic Jacobians. Degrees of freedom come from numerically
ranking the Jacobian, which is what lets the status bar say *"2 things can still move"*.

Three things learned building it, all of which are now regression tests:

1. **Never add anything to the objective that is not a residual row.** The first version
   pulled variables toward their previous positions via the normal-equation diagonal to
   stop under-defined sketches drifting. That biased every converged answer: a line
   dimensioned to 50 mm solved to 49.9996. Damping belongs in the Levenberg term, which
   vanishes at the solution; regularisation does not.

2. **A drag must be a *weak* term, not a strong one.** Least squares negotiates between
   every term, so a heavy drag weight does not lose an argument with a pinned point — it
   drags the pinned point. Weighted at 0.003 the cursor is followed exactly in directions
   the constraints leave free, and overruled to within a fraction of a micron in
   directions they own. Releasing the mouse re-solves without the drag term, restoring
   exactness.

3. **Regularisation must be far weaker than the drag** or it fights the cursor in exactly
   the directions the drag is supposed to own.

## 5. The catalogue

JSON is the engineering truth. Outline, mounting holes, keep-outs and connector openings
are what geometry is generated from, and they must be measured. A prettier visual is
optional decoration and never drives dimensions. That split is what lets someone
contribute a usable part in fifteen minutes with a caliper and no CAD.

**Every part declares a `confidence`** — `datasheet`, `measured` or `approximate` — and
the interface shows it. This is the most important field in the schema. A catalogue that
quietly mixes verified numbers with someone's best guess is worse than no catalogue: it
costs a user a mis-cut panel and, once, all of their trust. Parts in the shipped set say
in `source` specifically what is *not* verified.

The generated features are the point of the whole app:

- **Mounting holes** with counterbores, projected into whatever the board sits on.
- **Standoffs** at each hole, bored for a self-tapper or a heat-set insert.
- **Port openings** punched through an enclosure wall with tolerance.

These reference the *placement*, not baked coordinates, so they recompute on every
rebuild. Moving a board drags its holes with it. This is verified by a test that moves a
Pi off the plate and asserts the plate returns to exactly its nominal volume.

## 6. Things that went wrong, kept as tests

Each of these was a real defect found during the build, and each now has a regression
test so it cannot come back quietly.

- **Circle recovery from projections** used a centroid to find the centre. A projected
  circle arrives as two semicircular arcs whose shared endpoints repeat three times in the
  flattened point list, dragging the centroid far enough off to fail a 2% radius check —
  so four perfectly good 2.8 mm holes exported as 48-sided polygons. Now a least-squares
  fit, which is immune to how the points are distributed.

- **SVG measures Y downward.** replicad's projection of a 70 mm plate comes back spanning
  y = 0 to −70. Exporting that straight to DXF would have handed users a mirror-image
  panel — discovered only after cutting it. There is now a test asserting the projection
  is not mirrored.

- **`renderer.setSize(w, h, false)`** told three.js not to set the canvas CSS size, so the
  canvas laid out at its device-pixel size. Every ray-cast was computed against a viewport
  twice the real one, and a click near the centre of the screen landed 380 mm away.

- **Picking depended on a frame having been rendered.** The raycaster reads
  `camera.matrixWorld`, refreshed by the renderer once per frame. Entering sketch mode
  moves the camera and the user can click before the next frame — casting the ray from
  where the camera used to be. Picking now updates the matrix itself.

## 6a. Interaction decisions made after first use

**Categories are narrow.** The first version filed everything with a PCB under
"board", which put a Raspberry Pi, an Arduino Nano and an OLED in one list. Nobody
shops that way. They are now split into single-board computers, microcontroller
boards, ports and connectors, displays, sensors, power, and the mechanical families.
Narrow categories make the list scannable without searching, which is the only reason
to have categories at all.

**Ports are catalogue parts.** A socket carries its own panel cutout, so placing one
against a wall and pressing "Port openings" cuts the right hole. Round cutouts are a
first-class shape, not a rectangle approximation: a barrel jack or an audio socket cut
square is a ruined panel, and those are exactly the parts a beginner reaches for first.

**Left-drag orbits, left-click selects.** The original code selected on pointer-down,
which meant every attempt to orbit also reselected whatever happened to be under the
cursor. The view felt like it was fighting back. Now the press position is recorded and
the decision is made on release: under four pixels of travel is a click, anything more
was an orbit. The same rule applies to sketch corners, which otherwise could be dragged
but never selected.

**Gizmos over number boxes.** Placed parts get a move gizmo and a turn gizmo, snapping
to 1 mm and 15 degrees. The turn gizmo shows one ring rather than three, because the
document model only allows rotation about the vertical axis and offering axes that
cannot move is worse than offering none. A drag writes transient updates and brackets
them so the whole gesture lands in the undo history as one step rather than sixty.

**Right-click asks the user nothing they do not know.** Constraints are the hardest
idea in parametric CAD, and the usual interface is a toolbar of seventeen glyphs. Here
you point at things and right-click, and the menu offers only what applies: two lines
give parallel, square, same length and angle; two corners give distances; a line and a
circle give tangent. The list is built by a pure function in `src/sketch/actions.ts`, so
what the menu offers is unit testable without a browser.

One subtlety worth keeping: right-click only changes the selection when nothing is
selected. Letting it add whatever was under the cursor seemed friendlier until
right-clicking near the sketch origin silently added a third item and emptied the menu.

## 7. Licensing

**AGPL-3.0-or-later for the application.** It is a web app, and the AGPL is the only
copyleft licence that bites for one: GPL's obligations trigger on *distribution*, and a
hosted fork never distributes anything. Under AGPL, anyone running a modified OpenKitCAD
as a service must publish their changes.

**CC0 for the catalogue.** Measurements of physical objects should belong to everyone, and
the data is far more useful if FreeCAD, KiCad or anyone else can lift it wholesale. A
catalogue becomes a standard by being copied, not by being fenced. Keeping it separately
licensed from the app is deliberate.

## 8. Where to take it next

In rough order of value per unit of work:

1. **Sketching on a picked face.** The kernel and document model already support it; only
   the interface is missing. This is the single biggest capability gap.
2. **More catalogue parts** — breadth here beats almost any feature.
3. **Per-edge fillet selection**, with the document model already in place.
4. **Disconnected-solid detection**, which would catch floating standoffs.
5. **Assembly mates**, if machines with moving parts ever become a target. This roughly
   doubles the interface surface, so it should wait for real demand.
