# Foundations

The first milestone of the Fusion 360 parity work. The decisions behind it were locked on
15 September 2026 and are summarised in §1. Everything after that is the contract the
implementation is built against.

## 1. Decisions this rests on

- Design workspace only: Solid and Sketch parity, plus the Surface and Mesh tabs. Full Fusion
  assembly set: components, linked copies, every joint type.
- Fusion vocabulary, with one plain-English hint per command.
- The bundled OpenCascade build is permanent. Delete Face, Replace Face, non-uniform scale and
  IGES are out; Split is built from booleans.
- One global timeline with a rollback marker.
- Strict history-based references. A reference that cannot be resolved is an error on the
  timeline, never a nearest-match guess. The naming scheme is an element map.
- Rebuilds use a prefix cache; live preview evaluates on top of it.
- The command panel floats at the top right of the canvas, draggable and collapsible.
- All Fusion units. The kernel works in millimetres.
- Designs from 0.6 and earlier are not migrated. They are refused on open and their autosave is
  discarded.

## 2. Milestones

**F1: document model and evaluator.** Document v2 (§3), the evaluator with instancing and the
prefix cache (§4), the main thread on v2 (§5), units. References stay geometric fingerprints
(`FaceRef`, `EdgeRef`) for one more milestone, and commands keep today's dialogs. Exit: typecheck
clean, `?selftest` all green, the smoke test in §8 passes in the browser.

**F2: strict references.** The element map (§6) replaces fingerprints everywhere. Picks carry
names, and a broken reference is a timeline error.

**F3: command panel, preview and timeline.** The command framework with live preview and
manipulators (§7), every existing command migrated to it, a draggable marker, reordering with
dependency checks, groups, editing in place.

**S: sketch parity.** Profiles from regions, Fusion's sketch tools with heads-up input, the
constraint panel, placed dimensions, the modify tools and projection (§8).

**L: look and feel.** Light and dark themes on one token set, the icon set and brand mark, the
faces-only view cube, the marking menu and mouse schemes (§9).

**A: assemblies.** Joints between snap points, as-built joints, joint origins, rigid groups, motion
links, driving, dragging and animating joints, and motion studies (§10).

**M: mesh.** The MESH tab: triangle mesh bodies that are inserted, prepared, cut and converted to
solids (§11).

**SF: surface and solid tools.** Loft, Sweep, Coil, Pipe, Thicken, Pattern, Mirror, Split Body and
Scale on the SOLID tab, and the SURFACE tab (§12).

**J: jank audit.** Press Pull, Offset Face and Draft, so Q and the marking menu work as in Fusion;
stale notices, plural labels, narrow windows and dead code (§13).

## 3. Document model v2

Types live in `src/doc/types.ts`. Pure helpers every layer shares live in `src/doc/model.ts`
and are tested by `src/dev/modeltest.ts`.

Stored lengths are millimetres and stored angles are degrees, always. `doc.units` changes display
and input parsing only.

Feature, body, component and occurrence ids are unique across the document and never contain
`/` or `|`.

### Components and occurrences

`components` holds definitions. The root component (`rootComponentId`) is the design itself and
is never an occurrence. An occurrence places one component inside another component's
definition: `parentComponentId` is the definition that contains it, `componentId` is what is
placed, and `transform` is a rigid 4×4 matrix in column-major order (three.js `Matrix4.elements`)
from the child's space to the parent's.

Because occurrences belong to definitions, every copy of a component carries its children: two
copies of an enclosure assembly both contain its screws. Components form a DAG, and
`wouldCreateCycle` guards every edit that adds an occurrence.

An instance is one path from the root. `expandInstances` walks the tree and yields each
instance's world matrix, its visibility (every ancestor visible) and whether it is negative (any
ancestor negative). Instance ids are `pathKey|bodyId`, where `pathKey` is the occurrence ids
joined by `/`, or `root` for the root component.

Catalogue parts are components whose `source.kind` is `catalogue`. They have no bodies and no
timeline features; the kernel generates their solid from the catalogue JSON, and their instances
use the component id as the body id. Placing a part adds a catalogue component and an
occurrence of it. Linked copies of a part share the component.

### Bodies

`component.bodies` holds each body's name, colour, visibility and negative flag. Geometry comes
only from the timeline. Every body has exactly one creating feature in the same component, one
whose `result` is `{ kind: 'newBody', bodyId }`. A body whose creator is suppressed, rolled back
or failed does not exist for evaluation.

### Timeline

`timeline` is every feature in the design in chronological order. Each feature names its
component and every body it touches:

- Solid producers carry `result: BodyOperation`: a new body, a join into one body, or a cut or
  intersection with one or more bodies. Standoffs only create or join; a lid always creates.
- Modifiers carry `bodyId` (fillet, chamfer, shell, hole, vent, port cutout, lid seat, combine)
  or `bodyIds` (move).
- A feature only touches bodies of its own component. Positions taken from a catalogue part are
  the exception: `occurrencePath` is the part's instance, and `contextPath` is the instance of
  the feature's own component that the positions are measured in, `[]` for the root.

`marker` is the rollback marker. `null` means the end of the timeline; features at an index
greater than or equal to the marker are rolled back and not evaluated. New features are inserted
at the marker, and a marker that is not `null` moves past them. `groups` are contiguous timeline
ranges.

`featureDependencies` lists what a feature must come after: its sketch, the shell or lid it
names, and the creator of every body it modifies or reads. `canMoveFeature` checks a reorder
against every dependency in the timeline.

### Rules carried over from 0.6

- A fillet or chamfer with no edges applies to every edge of its body.
- A `through` hole or vent cuts past the far side whatever the thickness.
- A vent's `margin` is the solid border left round the outside.
- A lid's `clearance` is the gap per side between the lid and the walls it drops between.
- Move turns the combined bounding-box centre of its bodies about X, then Y, then Z, then
  translates. It is a timeline step so that sketches drawn on a face before the move stay attached.
- A negative body or occurrence is cut out of everything it overlaps instead of being material.

### Parameters

`bindings` attach an expression to a numeric feature field by feature id. Resolution writes the
values into a clone before evaluation; stored expressions stay.

### Old designs

`format: 'openkitcad'` with `version: 2` identifies a design. Anything else is refused on open,
import and share-link load with: *This design was made with OpenKitCAD 0.6 or earlier and can't
be opened by this version.* The autosave key `openkitcad.autosave.v1` is removed on startup, and
v2 autosaves use `openkitcad.autosave.v2`.

## 4. Evaluation (worker)

The types crossing the worker boundary live in `src/kernel/types.ts`. `KernelApi` is an explicit
interface: the worker's exposed object must satisfy it, and the main thread wraps it from
`types.ts`, never from `worker.ts`.

**Order.** Resolve parameters on a clone. Walk `activeFeatures(doc)` in order, keeping each body's
shape, the sketches, the pre-shell snapshots lids need, and the errors. Then build catalogue
solids, expand instances, apply negative cutters, and tessellate.

**Failures.** A feature that throws records a `KernelError` with its `featureId` and a
plain-English hint, and leaves body state as it was. A feature whose sketch, body or lid is
missing records an error naming what is missing. A feature that depends on a failed one records
*Depends on {name}, which failed*.

**Prefix cache.** The state after each active feature is cached under a key chained from the key
before it:

`key[i] = hash(key[i-1], canonicalJson(feature[i] after parameter resolution), externalInputs(feature[i]))`

External inputs are the world matrices of any `occurrencePath` or `contextPath` the feature reads
and the catalogue data of those parts. The key before the first feature hashes the custom parts
sent with the document. Evaluation resumes from the longest cached prefix. States are immutable
snapshots, and shapes shared between snapshots are not copied. Eviction is least-recently-used
with a count cap and releases shapes no remaining snapshot holds. `EvaluateResult.cache` reports
hits, misses and entries so tests can assert reuse.

**Meshes and instances.** A body's mesh key is `hash(key of the last feature that changed it,
bodyId)`; a catalogue solid's is `hash(partId, overrides, part data)`. Tessellations are cached by
key. The main thread sends the keys it already holds (`knownMeshKeys`) and the worker returns only
the meshes it lacks, transferring the typed arrays. Each instance names a mesh key and carries its
world matrix, so linked copies share one mesh.

**Negative cutters.** Negative bodies, and instances under a negative occurrence, cut every other
instance they overlap. Pairs whose world bounding boxes do not intersect are skipped. The cut runs
in the target's local frame through the element map (§6), so the displayed faces keep the timeline
names they came from: a face the cutter splits shows its parent's name on every piece, and a face
the cutter made has no name and cannot be referenced. A cut instance gets its own mesh key,
`hash(mesh key, instance matrix, cutter keys and matrices)`; an uncut instance keeps the shared
key.

**Preview.** `preview({ doc, features, insertAt, replaceFeatureId })` evaluates
`timeline[0..insertAt)` plus the pending features, replacing `replaceFeatureId` when given, and
nothing after, the way Fusion rolls the timeline back while a feature is being edited. It uses the
same cache, returns a full `EvaluateResult` with every instance flagged `preview`, and never
changes what the next `evaluate` returns.

**Exports and checks** take instance ids and work on world-space shapes: `exportStep`, `meshOf`,
`project`, `printPrep`, `distanceBetween`. `clearance` checks catalogue keepouts and instance
overlaps across the whole assembly. STEP goes through the worker's own XCAF writer, where every
OpenCascade object has exactly one owner: replicad's `exportSTEP` frees its work session twice when
the garbage collector runs, which corrupts the WebAssembly heap several calls later.

## 5. Main thread

- **Store.** Undo and redo snapshot the whole document, as now. `activeComponentId` decides where
  new sketches, bodies and features go (Fusion's Activate Component). Selection kinds are none,
  body, occurrence, feature, face and edge, and picks carry an `instanceId`. Feature edits go
  through helpers that keep the §3 invariants: insert at the marker, create and remove `Body`
  entries together with their creator, refuse to delete a feature with dependents unless the
  dependents go too, validate reorders with `canMoveFeature`.
- **Rebuild.** Coalesced as now. Sends `knownMeshKeys`, keeps meshes by key and the latest
  instances, and drops meshes no instance references.
- **Viewport.** One three.js mesh per instance, sharing geometry per mesh key, with
  `matrixAutoUpdate` off and the matrix taken from the instance. A pick resolves an instance and
  then a face or edge in that mesh's local space.
- **Persistence.** v2 only, as in §3. Share links and custom parts behave as now.
- **Units.** Document Settings in the Browser picks mm, cm, m, in or ft. Every length field shows
  the document unit and reads plain numbers in it; explicit suffixes (`mm cm m in ft`) always
  work.
- **Browser in F1.** Document Settings, Origin, the component tree with visibility and Activate,
  bodies and sketches under their component, catalogue parts as components.
- **Timeline in F1.** One strip in global order, showing the marker and suppressed and failed
  features. Dragging arrives in F3.

## 6. Element map (F2)

Every face, edge and vertex of every body state carries a name, built from the feature that
created it and the element it came from, and rewritten through the history each OpenCascade
builder reports.

- Every operation runs through a builder whose history is read: `BRepPrimAPI_MakePrism` and
  `BRepPrimAPI_MakeRevol` for extrude and revolve; `BRepAlgoAPI_Fuse`, `Cut` and `Common` with
  `SetToFillHistory(true)` and `SimplifyResult(true, true, tolerance)` for booleans, which merges
  coplanar faces without losing history; `BRepFilletAPI_MakeFillet` and `MakeChamfer`;
  `BRepOffsetAPI_MakeThickSolid`; and so on. replicad's convenience methods discard their
  builders and are not used for anything that must keep names.
- **From a sketch.** Side faces are `{featureId}:side:{sketchEntityId}`, caps are
  `{featureId}:start` and `{featureId}:end`, and edges and vertices take the entity or point they
  sweep. Profile edges are matched to sketch entities inside the same evaluation, where the
  geometry is identical by construction.
- **Primitives** name faces by role, such as `{featureId}:+x` or `{featureId}:side`.
- **Modified one to one:** the child keeps the parent's name.
- **Split into several:** `{name}#{k}`, with `k` ordered by the sorted names of each child's
  neighbouring elements, and by centroid along the parent's principal axis only when those tie.
- **Merged into one:** `{a}|{b}` in sorted order; a reference to any parent resolves to the merged
  child.
- **Generated from a parent**, such as a fillet face from an edge: `{featureId}:gen:{parentName}`.
- Names over 128 characters are replaced by a 64-bit FNV-1a hash in hex, with the full form kept
  for error messages.
- A reference is `{ bodyId, kind, name }`. Resolution returns exactly one element or fails. There
  is no fallback.
- **Meshes and picks.** Every face and edge group in a mesh carries its element name, and picks
  carry it. Selection ids are built from names, so a selection survives a rebuild.
- **Face planes.** A sketch or feature placed on a face needs a flat face. Its frame's origin is
  the component origin projected onto that face's plane, the way Fusion places a sketch, so a
  sketch does not drift when the face grows. The worker returns every resolved plane in
  `EvaluateResult.planes`, the store keeps them, and a sketch on a face appears once its plane has
  arrived.
- **Copies.** Pasting a copy renames the feature ids inside element names. A hashed name cannot be
  renamed; that reference fails and asks for a new pick.

## 7. Command panel and timeline (F3)

Commands are declarative (`src/ui/command/specs`): an id, a Fusion label, a plain hint, typed inputs
(selection with a filter and a count, length, angle, integer, choice, toggle) and a pure
`build(values, context) => Feature[]`, with optional `validate` and `handles`. The context carries
the document, the unit, stable ids for the session and the step being edited. The panel floats at
the top right of the canvas, drags and collapses to its title bar, with OK and Cancel at the
bottom; Enter commits and Escape cancels. A choice or toggle moves selection to the first visible
selection input still missing picks, and a pick goes to whichever visible input accepts its kind.

**Preview.** Every input change requests a debounced `preview`. The worker re-evaluates the pending
steps instead of reading them from the cache and returns the tools of cutting steps as instances
flagged `previewTool`, drawn as a see-through red volume that cannot be picked. The viewport shows
the preview scene until the command closes. Editing a step reopens its command with its values,
keeps its id, its name and the bodies it makes, previews with `replaceFeatureId`, and replaces the
step in place in one undo step. A parameter link survives an edit only while its field still shows
the linked expression.

**Handles.** A command declares arrows (anchored at a point with a direction, or on a named edge)
and arcs against a length or angle input, in component space. Arrows keep a constant screen size,
ignore the depth of the model, snap to the move and angle steps (Alt drags freely) and respect the
input's limits. A value box sits beside each tip and takes typing.

**Timeline.** Playback buttons (start, back, play, forward, end), then the steps as icons. The
marker drags between steps and rolls the design back as it moves; marker moves merge into one
undo step. Steps drag to reorder, validated by `canMoveFeature`, with a drop line that turns red
where the move is not allowed. Shift-click selects a range; the right-click menu has Edit Feature,
Suppress Features, Roll History Marker Here, Group Selected and Delete. Groups are ranges stored in
`doc.groups`, shown as a bracket or folded into one icon, and dropped when a move or a delete breaks
them. Failed steps are red, warnings amber, rolled-back and suppressed steps faded, and while a step
is being edited the steps after it fade too.

## 8. Sketch (S)

**Regions and profiles.** `src/sketch/regions.ts` builds a planar arrangement of every
non-construction curve: curves split where they cross, touch or end on each other, dangling pieces
are pruned, faces are traced with the clockwise-next rule, bridges drop out and islands nest as holes
of the smallest face around them. A region's key is its sorted piece labels, each label naming the
entity and the causes of both of its ends, so keys survive dimension changes and only change when
topology does. A region is solid when an even number of hole rings enclose it. Extrude and Revolve
store `profiles` (region keys); without them the step uses every solid region. The union of picked
regions is traced from the half-edges no other picked region shares, contiguous pieces of one entity
are joined back together, and a key that no longer exists fails the step. The kernel builds each
loop from exact curves: segments, circular and elliptical arcs trimmed by parameter, B-spline
segments cut with `Segment`, full circles and ellipses as one periodic edge. Side faces are named by
piece: `feature:side:entity` when a piece is the whole entity, `feature:side:entity[start|end]`
when it is part of one.

**Viewport.** Visible sketches draw as thin lines with their profiles shaded; a command that takes
profiles hovers and toggles them, and picking a sketch in the Browser means all of its solid
profiles until a single profile is clicked. A step that uses a sketch hides it. Show Profile shades
the active sketch too.

**Tools.** `src/sketch/tools` is one framework for every drawing tool: a spec has click prompts, a
`frame` that turns the state and the snapped cursor into preview curves and heads-up fields, and a
`build` that writes entities and constraints through a writer that also adds the constraint for
whatever the click snapped to. Typed values lock a field, Tab moves on, Enter places, and locked
values become dimensions. Lines chain until the loop closes. Tools stay active until Escape.

**Constraints and dimensions.** The CONSTRAINTS panel applies to the selection or waits for the picks
it needs (`src/sketch/constraintTools.ts`). Glyphs are selectable and Delete removes them. Sketch
Dimension picks geometry, follows the cursor to choose aligned, horizontal or vertical, and places the
dimension where it is clicked with an inline value box (`src/sketch/dimensions.ts`). Dimensions keep
their label spot in `at`, draw extension lines and arrows at constant screen size and drag without a
rebuild, because `at` is left out of the cache key.

**Modify.** Trim, Extend and Break work on every curve kind and pin new ends to the curve they met
(`src/sketch/modify.ts`); splines are cut exactly into control point pieces. Offset walks connected
chains and rebuilds their corners (`src/sketch/offset.ts`). Mirror copies across a picked line with
symmetry constraints; Move/Copy, Sketch Scale and the patterns act on the selection. Project brings a
body edge, or every edge of a face, in as fixed lines, circles, arcs or splines; it is a copy, not a
link.

**Rebuilds.** Edits inside the active sketch update only the sketch. The model rebuilds once when the
sketch is finished.

## 9. Look and feel (L)

**Themes.** `src/theme/tokens.css` defines every colour for light and dark; the older `--bg`,
`--panel`, `--accent` names map onto the tokens, and no stylesheet carries its own palette. The theme
is Light, Dark or Match the system (`src/theme/theme.ts`, stored in `okc.theme.v1`). The viewport
reads its colours from the same tokens (`src/theme/palette.ts`) and redraws when the theme changes.
Selection and pre-highlight are blue.

**Icons and brand.** Full colour isometric icons live in `src/ui/icons` (solid, modify, sketch,
assemble, mesh, surface). Flat
sketch icons carry the class `okc-icon-2d` so their line work lightens in the dark theme. The brand
mark is a blue square with an open box, drawn in `src/ui/BrandMark.tsx`.

**View cube.** Six labelled faces follow the camera through CSS transforms and swing the view there
when clicked; the house returns home. Edges and corners are not selectable: US7782319B2 runs to
March 2029 and its first claim needs faces, edges and corners together.

**Marking menu.** Right-click opens eight commands around the cursor with the context list below.
Repeat reruns the last command or sketch tool.

**Mouse schemes.** Fusion, SolidWorks, Onshape and Tinkercad bindings (`src/ui/mouse/schemes.ts`)
set the orbit, pan and zoom buttons per press, reverse the wheel for SolidWorks, and a right-button
drag in the Onshape and Tinkercad schemes never opens the context menu.

## 10. Assemblies (A)

**Solver.** `src/assembly` is a kinematic solver that knows nothing about the kernel. Every occurrence
path is a node with a world pose; joints, as-built joints and rigid groups are edges between nodes,
each joint carrying the degrees of freedom of its motion (rigid, revolute, slider, cylindrical,
pin-slot, planar, ball) with limits, a lock and its current values. Grounded occurrences and the top
design do not move. A solve drives chosen values, follows a drag in the free directions only and
reports conflicts per joint. `fromDocument.ts` turns the timeline into solver input and writes the
result back as occurrence transforms and joint values.

**Joints in the document.** Joints, joint origins, rigid groups, motion links and motion studies are
timeline features the kernel skips. A joint side is an occurrence path, the snap it came from (a
named face or edge, a keypoint, or a joint origin) and a frame in that component's coordinates. The
two frames meet face to face: component 1's Z points against component 2's, Flip turns it round,
Angle turns about Z and Offset Z lifts along it. Creating or editing a joint moves whichever side is
free, preferring component 1; editing keeps the driven values when the motion kind stays the same.
Deleting a component deletes its joints and the links that use them, a rigid group loses the member
and goes when fewer than two remain, and deleting a joint origin deletes the joints built on it.

**Snap points.** Hovering while a snap input is active shows the snap glyph and its name. A flat face
gives its area centroid with the outward normal; a round face gives its axis, at the end nearest the
cursor or the middle; a round edge gives its centre, pointing along the face under the cursor; a
straight edge gives its middle or the end near the cursor. Catalogue parts have no element names, so
their faces and edges are found by id and the joint keeps only the frame.

**Following geometry.** After every rebuild, joints and joint origins that snapped to a named face or
edge look the snap up again, keep their X direction and re-solve, so a joint on the top of a box
rides up when the box gets taller. Occurrence transforms reach the screen before the kernel answers.

**Commands.** Joint (J), As-built Joint (Shift J), Joint Origin, Rigid Group, Drive Joints and Motion
Link are command panels with previews. Ground and Unground are in the Browser and the context menu.
The inspector for a joint drives each value, sets minimum and maximum limits, locks it and animates
it. Dragging a jointed component with the gizmo slides it along its joints. Motion Study has its own
panel: joints with values at steps, a scrubber, play and loop; it poses the assembly while it is open
and puts it back when it closes. Contact sets are not implemented.

## 11. Mesh (M)

**Mesh bodies.** A mesh body is a body whose shape is a triangle mesh rather than OpenCascade B-rep.
The algorithms in `src/mesh` are plain TypeScript and run under Node: STL, OBJ and 3MF reading and
writing, welding, repair, a capped plane cut, Taubin smoothing, quadric error reduction, isotropic
remeshing and a display tessellation. Inserted mesh data is stored once by content hash in
`src/doc/meshData.ts`, outside the undo history; saved files, autosave and share links carry it as
`meshData`, and the kernel receives each blob once. `BodyMesh.kind` is `solid`, `surface` or `mesh`,
and a mesh also reports its loose pieces and whether it is watertight.

**Display.** Mesh bodies are drawn with normals creased at 30° and with their boundary and feature
edges (40°) as lines, so a faceted import still reads as a part.

**Commands.** Insert Mesh (unit, Y is up, center, place on ground), Tessellate (coarse, medium,
high), Repair (reorients triangles and can close holes), Remesh (edge length, keeping sharp edges,
every vertex projected back onto the original surface), Reduce (by proportion, tolerance or face
count), Smooth (strength and passes, without shrinking), Reverse Normal, Plane Cut (split, trim or
trim the other side, with an optional fill), Separate, Combine and Convert Mesh (faceted gives one
face per triangle, prismatic merges coplanar triangles into faces). Mesh bodies are listed under
Mesh Bodies, move with Move and export to STL, 3MF and OBJ. Solid and surface commands refuse them
and say to convert first. Face groups, Erase and Fill, mesh Shell and Direct Edit are not
implemented.

## 12. Surface and solid tools (SF)

**Sketch chains.** `src/sketch/chains.ts` walks the curves of a sketch into connected runs, open or
closed, ignoring construction geometry. Surfaces are built from those runs, and a path for Sweep or
Pipe has to be exactly one of them.

**Solid tools.** They run in `src/kernel/solidSteps.ts` before the other steps. Loft blends one closed
profile from each picked sketch, in the order picked, smoothly or with straight sides. Sweep carries a
profile along a path sketch. Coil takes a plane, a centre, a diameter, revolutions, a height and a
circular, square or triangular section, and warns when the turns touch. Pipe runs a round, square or
triangular section along a path sketch and can be hollow. Pattern copies bodies in rows and columns
along X, Y and Z or around an axis, and Mirror copies them across a plane; every copy is a new body
whose id is kept when the step is edited. Split Body cuts a body with a plane using two booleans
against a half space and fails when the plane misses. Scale is uniform, about the middle of the
picked bodies. The bundled kernel cannot do non-uniform scale.

**Surfaces.** A body is a surface when its shape holds no solid; it draws from both sides, shows ▭ in
the Browser and has no volume. Extrude, Revolve, Sweep and Loft have Surface commands that set a
`surface` flag on the same feature and always make a new body; Extrude and Revolve Surface accept
open sketch curves. Patch fills a closed outline. Offset makes a new surface a distance away. Thicken
turns a surface into a solid on one side or both, with the usual operations. Stitch sews surfaces
within a tolerance into the first one, makes a solid when they close all the way round and consumes
the rest. Unstitch gives every face its own surface body; if the body gains faces upstream, the
extra faces stay together in the last body with a warning. Reverse Normal turns surfaces inside out.

**Ribbon.** The SOLID tab shows Extrude, Revolve, Sweep, Loft and Hole under CREATE and Press Pull,
Fillet, Shell and Move under MODIFY; everything else is in the group menus, and the whole ribbon
fits a 1280 px window. The SURFACE tab shows Extrude, Revolve, Loft, Patch, Offset and Thicken, then
Stitch, Unstitch and Reverse Normal. Torus sits with Box, Cylinder and Sphere in the CREATE menu.
Trim, Extend, Ruled, Boundary Fill, Rib, Web, Emboss, Thread and Pattern on Path are not implemented.

## 13. Jank audit (J)

**Press Pull, Offset Face and Draft.** Offset Face moves flat faces of a body along their normals: a
prism from each face is fused on or cut away, the result is simplified, and the history hands each
face's name to the face that replaces it, so later steps still find it. Curved faces are refused
with a message, because the bundled kernel has no per-face offset. Press Pull (Q, the right slot of
the marking menu and the face context menu) opens Fillet when edges are selected, Extrude when a
sketch is, and otherwise Offset Face under the Press Pull name; the timeline records Offset Face, as
Fusion does. Draft tilts faces about a plane by an angle, away from the plane's normal or towards it
with Flip. Scale Factor and Coil Revolutions use a plain number field (`kind: 'number'`) that no unit
touches.

**Create Sketch.** Create Sketch no longer asks for a plane in a dialog. The three origin planes
appear as translucent squares reaching past the model, a hovered plane darkens, and a click on a plane
or on a flat face opens the sketch there; Esc cancels. The same planes appear whenever a command's
Plane input is waiting, so Mirror, Split Body, Coil and Draft take a click on an origin plane.

**Construction planes.** Offset Plane, Plane at Angle and Midplane are timeline features
(`constructionPlane`) under CONSTRUCT. The kernel resolves each into the same plane table sketches use,
and a plane reference can now name one (`{ kind: 'construction', featureId, offset }`), so sketches,
Mirror, Split Body, Coil, Draft and further planes can be built on them and follow when they move.
Offset Plane takes a face or plane and a distance with a drag arrow; Plane at Angle turns about the X,
Y or Z axis; Midplane sits halfway between two parallel planes or bisects two that meet, through the
side where both lie. They are listed under Construction in the Browser with a visibility toggle, drawn
as translucent squares that highlight under the pointer, and a click selects one or hands it to a
waiting Plane input or to Create Sketch. The Origin planes in the Browser also hand themselves to a
waiting command instead of always starting a sketch.

**Revolve about a line.** Revolve (and Revolve Surface) take an Axis: a straight line in the
profile's own sketch, usually a construction centreline, picked in the view with a hover label, or
the sketch X or Y axis when nothing is picked. The step stores the line's id (`axisLine`), so moving
the line in the sketch moves the axis.

**Tidying.** Counts read "1 body" and "2 bodies" (`src/core/words.ts`). The Inspector hides while a
command panel is open, and surface bodies no longer offer edge rounding. The Shortcuts dialog no
longer claims surfaces and Press Pull are missing, and P outside a sketch says Project needs one.
Below 1280 px the ribbon tools shrink, and below 1024 px the ribbon scrolls sideways with its menus
pinned under it, so the page itself never scrolls. An unused welcome screen and three unused helpers
are gone.

## 14. How the work is done

- Agents never start other agents or workflows.
- New and rewritten code has no comments. Touched files are formatted with Prettier.
- Commits go on `fusion` locally, in the repo's message style. Nothing is pushed by an agent.
- `src/doc/types.ts`, `src/doc/model.ts`, `src/kernel/types.ts` and `src/main.tsx` are the
  contract. They change only additively, only when work cannot proceed otherwise, and every
  change is listed in the agent's report.
- `?kerneltest` runs the model and kernel tests without the app; `?selftest` runs everything.
  Results are on `window.__okc_tests`.
- **F1 smoke test.** Create a sketch on XY, draw a rectangle, extrude it 3 mm and fillet every edge
  1 mm. Insert a Raspberry Pi 4 and add its mounting holes to the plate, move the Pi and watch the
  holes follow. Create a component, make a linked copy and move the copy. Undo and redo each step.
  Save, reload and open the file. Switch units to inches and read a 100 mm edge as 3.937 in.
- **F2 smoke test.** On a 40 x 30 x 20 mm box, right-click the top face and draw on it, extrude a
  circle into a new body, round a picked vertical edge, and hollow the box through the top face
  with a ledge lid. Make the box 35 mm tall: the circle body, the rounding and the lid follow with
  no errors. Undo and redo.
- **F3 smoke test.** Sketch a rectangle and extrude it from the toolbar; drag the distance arrow and
  watch the preview follow before OK. Sketch a circle on top and extrude it as a cut, checking the red
  tool before OK. Double-click the first extrude on the timeline, change its distance and OK. Drag
  the marker back one step and forward again, drag a step to a new place, try to drag a fillet
  before its body and see it refused, group two steps and expand the group.
- **S smoke test.** On XY draw a 40 x 30 rectangle by typing both sizes, a circle across its right
  edge and a line through it, trim the part of the circle inside the rectangle, fillet one corner and
  dimension the line. Finish the sketch, extrude two of the regions and check the preview only covers
  those two. Sketch on the top face, project the face, offset it 3 mm inward and extrude the ring as a
  cut. Undo back through every step.
- **L smoke test.** Switch to Dark and back: panels, canvas, grid, sketch lines and dimensions follow.
  Click FRONT on the cube, then the house. Right-click the model and run Press Pull from the ring, then
  Repeat. Choose the SolidWorks scheme and orbit with the middle button.
- **A smoke test.** Insert a NEMA 17 stepper and a 608ZZ bearing and ground the stepper. Press J, pick
  the bearing's bottom and the round boss on the motor, choose Revolute and OK: the bearing sits on
  the boss around the shaft. Select the joint, drive it to 45°, give it a 135° maximum and try 200°.
  Drag the bearing with the gizmo and see it only turn. Animate the joint and click to stop. Make a
  Motion Study that turns it 180° over 60 steps, scrub to the middle and play. Add a Box, joint a part
  to its top face, make the box taller and see the part follow. Undo back through every step.
- **M smoke test.** Insert a torus STL with Place on Ground. Plane Cut it on XY at its middle as a
  split and see two watertight halves. Reduce one half to 50%, remesh the other at its average edge
  length and smooth it. Convert one half as prismatic, Separate a two-piece mesh, Combine two meshes
  and Reverse Normal one. Export the design as OBJ. Undo back through every step.
- **SF smoke test.** On XY draw three connected lines, then on the SURFACE tab Extrude them 10 mm as
  a surface and Thicken it 2 mm into a new body. On the SOLID tab loft a 20 mm square on XY into a
  circle on a plane 20 mm up, sweep a circle along a bent path sketch, and make a Coil. Pattern a body
  six times around Z, mirror it across YZ, split a box on XZ and scale a body by 2. Unstitch a box
  into six surfaces, Stitch them back into a solid and Reverse Normal one of the surfaces first.
  Double-click each step on the timeline, change a value and OK. Undo back through every step.
- **J smoke test.** Click Create Sketch and then the XZ plane, finish, click Create Sketch again and
  click the top of a box. Make an Offset Plane 20 mm above XY, sketch on it and extrude, then edit the
  plane to 30 mm and see the extrude follow. Select the top face of a box and press Q: the Press Pull panel pulls it 8 mm with
  the arrow. Select an edge and press Q to get Fillet; select a sketch and press Q to get Extrude.
  Right-click a side face and choose Draft, pick XY as the plane and tilt it 10°. Scale a body by 2.5
  in an inch document and read 2.5, not a length. Open any command and see the Inspector step aside.
  Narrow the window to 950 px and scroll the ribbon. Undo back through every step.
