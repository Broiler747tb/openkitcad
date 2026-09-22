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

**All twelve are done.** The last of them landed on 18 September 2026 and the work shipped to
`main` as 1.0.0 the day after, with 1035 checks green. What comes after this is in `DESIGN.md`
§8; nothing in the list below is outstanding.

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

**P: parts.** The Components tab ranked by popularity, with families of versions and a picker,
favourites, recently used, filters and a details card, drop on a face, and managing your own parts
(§14). Then true-to-life looks with rendered previews, and every part pinned to a real, named product
where a maker publishes its sizes, with clones kept as labelled generic versions.

**FT: fits.** Seven fits tuned for 3D printing, each placed by clicking a face: Snap Fit, Alignment
Pins, Lip and Groove, Dovetail, Snap Ring, Bayonet and Print-in-place Hinge, with printer-wide fit
classes that live in the design as parameters (§15).

**EM: text and emboss.** Sketch text in the fonts on this computer, kept in the design as letter
shapes, usable as a profile anywhere a profile is, and Emboss to raise or sink it on a flat face or
round the side of a cylinder (§16). Then Rib and Web, the thin walls that brace a printed part
(§17), the fit test coupon that measures what a printer really leaves (§18), the
cable entries that get a lead out of a box (§19), the clips that hold a board without screws
(§20), the screw lid that closes a round opening (§21), the enclosure that puts a box, a lid,
mounts and openings round the parts you picked (§22), and the KiCad import that turns a board you
designed into one of your own parts (§23).

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
- A lid's `clearance` is the gap per side between the lid and the walls it drops between. Its `fit`
  is `ledge`, `snap` (a ridge skirt), `hooks`, `hinge` or `friction`; `hooks` and `hinge` carry
  their sizes (§15).
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

**Text.** The Text tool places a text where it is clicked and opens a panel with the words, the
font, the height of the capitals and an angle, previewing in the sketch as it is typed; OK is one undo
step and Cancel puts the sketch back. Double-clicking a text, or Edit Text... in its right-click menu,
reopens the same panel. The letters are a profile in their own right, keyed `text:entity`, so they
extrude, cut, revolve and emboss like any closed area, and a picked area with a text inside it comes
out with the letters cut away unless the text is picked too (§16).

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
Fillet, Shell and Move under MODIFY and Snap Fit under FIT; everything else is in the group menus,
and the whole ribbon fits a 1280 px window (tools draw compact below 1366 px, and the ribbon scrolls
if it still overflows). The SURFACE tab shows Extrude, Revolve, Loft, Patch, Offset and Thicken, then
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

**Select and the right-click menus.** Every ribbon, the sketch one included, ends in a SELECT group.
Its Select tool is highlighted while nothing else is running; clicking it (or Esc) stops the current
tool, command or plane pick and goes back to picking without dropping the selection. The menu holds
Clear Selection, plus Select All and Invert Selection in a sketch. The marking ring measures itself,
moves back on screen near an edge and tells the action list where it is; the list goes below the ring,
above it, beside it with a scrollbar, or shortened, but never on top of it (`placeAround` in
`ContextMenu.tsx`).

**Negative distances cut.** Extrude takes a negative distance, and Box and Cylinder a negative
height, and build the other way. Box and Cylinder used to accept one and then fail to build; the
primitives now build down from the plane. When the profile or the placement plane is a face of a body,
going into that body switches the operation to Cut on it, and coming back out switches it to Join, as
Fusion does. The switch runs through a `derive` hook on command specs that reacts to one field changing.
The older fixed dialogs that duplicated these commands are gone: Extrude in the Inspector's Actions tab
and the Edit Feature quick action open the Extrude, Box or Cylinder panel, so a negative value cuts
there too, and the unreachable Move, Hole and Extrude fallbacks in `resolveCommand` were removed.

**Tidying.** Counts read "1 body" and "2 bodies" (`src/core/words.ts`). The Inspector hides while a
command panel is open, and surface bodies no longer offer edge rounding. The Shortcuts dialog no
longer claims surfaces and Press Pull are missing, and P outside a sketch says Project needs one.
Below 1280 px the ribbon tools shrink, and below 1024 px the ribbon scrolls sideways with its menus
pinned under it, so the page itself never scrolls. An unused welcome screen and three unused helpers
are gone.

## 14. Parts (P)

**Ranking and families.** Every shipped part carries `popularity` (1 to 100), a curated estimate of
how often hobby projects use it, and the catalogue is sorted by it. Parts that are versions of one
thing name a `family` from `src/catalogue/families.json` and a short `variant` label. Browsing and
search collapse a family into one row that opens the version picker; a family with one matching member
shows as that part. `src/catalogue/search.ts` scores every term against name, family, version, tags,
id, maker, type and summary, with exact, prefix, substring and one- or two-typo matches, synonyms
(rpi, type-c, screen, knob and so on) and `m3x10` split into size and length. All terms must match.

**The Components tab** (`src/ui/parts`). A search box with a clear button and two filters, Verified
sizes (not approximate) and Mounting holes. With no search it shows Favourites, Recently used (eight),
Popular, the types with counts, and Your parts. Search results can be narrowed by type. A row opens
the details card; its hover buttons star it or insert it at the origin. The details card has a drawn
preview, the size, hole pattern, panel hole, thread, ports, headers and power, how the sizes were
sourced, links, the other versions, Insert, and Edit or Copy and edit for boards; a shaped outline
such as the Uno's is copied as it is unless the width or depth is changed in the form. The
version picker floats beside the panel with one card per version drawn at a shared scale. Previews
are SVG drawings made from the part data (`PartSketch.tsx`). Favourites and recent parts are kept in
localStorage. The panel widens to 320 px while it is open.

**Drop on a face.** Rows, cards and the details preview drag into the view. While dragging, a box the
size of the part follows the face under the pointer; empty space means the ground plane. A board, a
standoff or a bearing lies flat on the face, centred on the pointer, with its top edge up on a wall; a
screw or insert sinks in with its head or top flush; a stepper hangs off the face with its shaft through
it; a port faces out of the face with its front on it. On a face square to the axes the drop point
snaps to whole millimetres. The placement is computed in the active component's frame
(`dropPlacement` in `src/catalogue/placement.ts`) and `insertCatalogue` takes the whole matrix.
Typing a position, turning or flipping keeps any rotation that is not a turn about Z (`withPose`),
and so do the move arrows and paste.

**Versions after placing.** Properties shows a Version list for a part in a family. Changing it swaps
the part in place (`swapCataloguePart`), keeping the placement and renaming the component and its
occurrences if they still had the old name.

**Pin headers.** Properties shows Pin headers for any board with pin rows. It starts as the board is
usually sold (a Nano or D1 mini with pins, a Pico or Pi Zero bare) and is stored on the component
source as `headers`, so linked copies share it, a version swap keeps it, and a design saved before
it opens unchanged. `withHeaders` in `src/catalogue/headers.ts` makes the part the look, the kernel
solid, clearance and port cutouts all use (through `effectivePart`). Switching off removes every
`header` look component and every bump, keepout or look box marked `"header": true`, so the pads
show instead. Switching on adds male headers to every pin row that has none: under the board with a
keepout for the pins, or on top as a solid bump for an SBC. Keepouts that mixed pins with other
parts were split, so a bare PIR sensor still keeps room for its pots.

**Your parts.** New part, Import (one part or a list, checked by `partProblems`, with a line per
refused part), Export all, and per part Edit, Duplicate, Export and Delete, which warns when the part
is placed. A user part with a shipped id overrides the shipped part and is marked. Edit keeps the id
and everything the form does not show.

**Looks.** A part's look is decoration drawn by three.js from its JSON, never used for geometry
(`src/viewport/partLook.ts`). The engineering solid from the kernel stays in the scene, hidden but
still picked, so selection, snapping, joints and measuring are unchanged; the look follows the same
matrix, takes the selection tint, dims and is clipped by section views. A look is built once per part
data hash and merged into one mesh per finish (pcb, plastic, metal, gold, brass, chip, glass, rubber,
anodised, translucent), lit with a room environment so metal reads as metal. Boards are the outline
extruded with plated holes and pads, plus `look.components` in part coordinates: box, cylinder, chip
(with legs), module (shield and antenna), header (male or female), port (usb-c, micro-usb, mini-usb,
usb-a, usb-a-stack, usb-b, hdmi, micro-hdmi, mini-hdmi, rj45, jack-35, barrel, microsd, sd, ffc, facing
one side), screen, button, led, crystal, capacitor, transducer, antenna, trimmer, terminal and jst;
`z` is the height above the part origin and defaults to the board top, `flip` mounts on the underside,
and `turn` rotates a box or chip about its centre for parts fitted at an angle (the Nano's ATmega, the
BlackPill's STM32). A board without components draws its bumps, and every pin row in `pinHeaders`
that no fitted header covers is drawn as plated pads. Panel parts pick a `look.style` (the
ports above, rocker, toggle, pot, encoder, led-holder, fan, jst-xh, terminal, xt, iec, banana, gx16,
sma, rca, dsub); screws, inserts, standoffs, steppers, bearings (`style: linear` for LM8UU) and
extrusion are drawn from their geometry. The selftest checks that every shipped look stays within 4 mm
of the part's measured size, widened by a board's bumps and keep-outs so overhanging ports and pins
under the board count, and fills at least half of it. It caught the Pico's headers running across the
board instead of along it, and generic modules whose transducers, domes and cans were missing from
their clearance heights.

**Where the sizes come from.** A part is `datasheet` only when its outline, holes, pins and port
openings come from something its maker published, and `source` says which document and how the
numbers were read. Raspberry Pi boards use the official mechanical drawings, read from the PDFs' own
vector geometry by scaling from the hole pattern or the 2.54 mm pin pitch rather than eyeballing a
render; the Pico family uses the datasheet figures the same way. Arduino's Uno, Mega and Nano, SparkFun's
Pro Micro and the Adafruit boards come from their Eagle board files, with outlines, holes, pin rows and
part positions taken directly (parts on the underside are rotated, then mirrored). Espressif, WEMOS,
the NodeMCU team, WeAct, Seeed, PJRC, BeagleBoard, Pololu, TowerPro, CNC Kitchen, Aosong and the
connector makers supply drawings, dimension tables, footprints or layout prints. This found real
errors: two Uno and Mega holes 10 mm off, the Pi 5 using the Pi 4's port layout, the Nano's headers
across the board and its corner holes missing, the BeagleBone's off-rectangle holes, the D1 mini and
Blue Pill clones given holes they do not have, and heat-set insert holes that matched no maker's table.
Boards sold by many makers with no drawing keep `approximate`, say "(generic)" in the name and share
a family with the pinned product, so the picker offers both. At the end of this round the catalogue
holds 125 parts in 32 families: 86 from maker data, 38 generic and 1 measured by hand. Popularity
is still a curated estimate, not measured usage.

**Pictures.** Rows show a rendered thumbnail, made off screen by one shared renderer a few per frame
and cached per part data (`src/ui/parts/render.ts`); the SVG drawing stands in until it is ready. The
details card and the version picker show live previews that turn when dragged and reset on double
click; the picker draws every version at one scale so sizes compare. Dragging into the view starts
from the card body or the handle under the details preview.

## 15. Fits (FT)

**Seven fits.** Snap Fit (a cantilever hook), Alignment Pins, Lip and Groove, Dovetail, Snap Ring,
Bayonet and Print-in-place Hinge. Each is one timeline step that changes two bodies in the same
component: `bodyId` gets the half that is added (hook, pins, lip, rail, bead, lugs, every other
knuckle) and `mateBodyId` gets the half that is cut (catch, sockets, groove, slot, groove, L-slots,
the other knuckles). Without a mate only the first half is built. They run in
`src/kernel/fitSteps.ts` right after the solid tools: each half is built from replicad primitives in
a local frame, placed with one transform and applied with the naming booleans, so later steps can pick
faces a fit made. A raw OpenCascade failure reads "Could not cut the fit into Case." instead of a
number.

**Placement.** Flat fits take a face, a position in that face's frame and an angle. Snap Ring and
Bayonet take a round face and the clicked point, which chooses the end the other part goes on from;
Other End flips it. Face picks in a command now carry the click point and normal, so a click places a
fit where it lands (Hole places its hole there too). The panel finds the other part from the meshes:
the nearest body of the same component beyond the face. Snap Fit then slides the arm onto the nearest
wall of that part and turns the hook into it, and Hinge puts its line in the middle of the gap between
the two parts. Alignment Pins adds a pin per click on one face and removes a pin when it is clicked
again (`merge` inputs now run `fills` for their first pick).

**Fit classes.** Press, Snug, Sliding and Loose are gaps per side, set once per printer in the
Parameters dialog and kept with the preferences (0.1, 0.2, 0.3 and 0.45 mm to start). Choosing a
class links the fit's `gap` to the design parameter `fit_press`, `fit_snug`, `fit_sliding` or
`fit_loose`, created from the printer table the first time a class is used; Use these gaps in this
design copies the whole table in. Typing a gap makes the fit Custom and drops the class link but keeps
a link to any other parameter. Editing a fit keeps or moves its link: `commit` in
`src/ui/command/session.ts` now drops a step's stale links before `adjust` adds new ones.

**Checks.** Snap Fit works out the strain as the hook clicks in (1.5·t·y/L², with L the arm up to
the hook) and warns past the material's limit (PLA 2%, ABS or ASA 3%, PETG 4%, nylon 6%), naming the
shortest safe arm; an arm too short for its hook is refused. Every fit probes the other body and warns
when the hook, sockets, groove, slot, lug slots or knuckles do not reach it. Pins warn when the other
part is too thin for the sockets, lips when they are wider than the wall they stand on, hinges when the
parts are closer than the gap, and bayonets when the lugs and twist do not fit round the face or the
twist leaves no room for a click stop. A window through the wall is cut to the far side of that wall
and no further.

**Shapes.** Hook: 30° lead-in, 0.4 mm land, a square catch (Permanent) or a 45° one (Removable), root
chamfers, and a relief of the gap along the arm and round the root in the wall. Pins: a chamfered tip;
sockets with a 45° lead-in and room under the tip. Lip and groove: inward offsets of the face's outer
edge, so they follow any outline; the groove is the lip grown by the gap. Dovetail: flanks leaning out
at the flank angle, the slot a gap wider at right angles to every face and open at the start or both
ends. Snap Ring: a bead with the hook's profile, optional flex slots in a post, and a clearance sleeve
and groove in the other part. Bayonet: lugs, an entry slot and a turn slot per lug, a clearance sleeve
and a 0.25 mm bump that the lug clicks over at the end of the turn. Hinge: alternating knuckles on
the gap line with 45° cones into matching sockets, each knuckle cleared by the gap in the other part,
so two plates printed side by side come off the bed joined and fold flat onto each other.

**Lids.** Shell's Make a Lid, and the Lid panel that reopens a lid from the timeline, offer Snap
hooks and Hinged beside Rests on a ledge, Snaps in and Just drops in, and set the lid gap by fit
class like the other fits (Hinged moves Snug to Loose). Both are built in the lid and seat steps from
the shape before hollowing, with the box's outline measured in the opening's own frame. Snap hooks
hang from the lid's underside in the middle of the two long walls, or all four, flush with the lid's
edge and without the outer root chamfer so they never touch the wall; the seat cuts their catches
into the walls, through them when the hook would leave less than 0.4 mm. Hooks longer than the box is
deep, or wider than a wall, are refused, and hooks that barely reach past the gap warn. Hinged gives
the lid a flange over one wall, lowers that wall by the lid's thickness plus the gap, and runs the
knuckles along its top outer edge: the lid carries the end knuckles and cones, the box the rest and
the sockets. Changing a lid's fit adds the seat step if it had none, and renames a seat that still
has its default name.

**Ribbon and tests.** A FIT group on the SOLID tab shows Snap Fit and lists all seven; the icons are
in `src/ui/icons/fit`. `?selftest&suite=fits` builds every fit, compares volumes with hand
calculations, intersects the two halves to prove they never overlap, checks each body is still one
piece, triggers every warning, and drives the panel: clicks against real meshes, class switching and
an edit moving the link.

## 16. Text and emboss (EM)

**Fonts.** `src/sketch/fonts.ts` lists the fonts installed on the computer through the browser's
Local Font Access, reads the chosen face with opentype.js and hands back outlines normalised so the
capitals are one unit tall and the baseline is y = 0. A `.ttc` collection is unpacked to the face that
was asked for by rebuilding its table directory. Where a browser cannot list fonts, or the person does
not share them, a font file can be loaded instead. The outlines go into the text entity, so a design
opens with the same letters on a computer that does not have the font; the font's name is kept only to
say what it was and to re-cut the letters when the words change.

**Text profiles.** A text is one profile, not one per letter (`src/sketch/text.ts`). Contours are
filled by the nonzero rule, so strokes that overlap inside a letter join and counters stay holes, and
the same rule shades the profile in the viewport, decides what a click on it hits and drives the
kernel. Some fonts draw a letter as one outline that crosses itself to make its counter, so an outline is
cut into simple loops at its crossings before anything is built from it.
`src/kernel/textProfile.ts` builds each contour from exact lines and Béziers. When nothing
overlaps, the letters become faces directly. When they do overlap, or a text lies on a picked area,
every contour is split against the others with OpenCascade's general fuse, each piece is kept or
dropped by the winding number at a point inside it, and the surviving boundary is chained back into
loops. Profile edges are matched to the text by exact point-to-Bézier distance, and each outline
segment carries its own naming token.

**Emboss.** One step (`src/kernel/embossStep.ts`) that reads a sketch profile and a face of a body
and fuses or cuts the shape. On a flat face the profile is moved onto the face's plane and extruded,
starting 0.2 mm inside the material so the join is clean; the sketch has to be parallel to the face.
On the round side of a cylinder the drawing is turned into the face's own coordinates — along the
surface by arc length, along the axis by distance — wrapped with `sketchOnFace`, offset 0.2 mm into
the material and thickened radially, each letter on its own so the booleans stay simple. It reads
which way the face looks out of the body, so a raised shape grows outwards on a rod and inwards on a
hole, and a sunk one cuts the other way. Text longer than the way round the face, a depth deeper than
the face is wide, a sketch across the axis, and any face that is neither flat nor round are all
refused in plain words.

**Ribbon and tests.** Text sits in the sketch CREATE list and Emboss in the solid CREATE list, next
to Loft. `?selftest&suite=text` builds a font in the test, reads it back through a written font file
and through a `.ttc` wrapper, and compares volumes with hand calculations: letters with their holes,
overlapping strokes merged, a plate with the letters cut out of it, a letter hanging over an edge,
text raised and sunk on a block, and text wrapped round a rod.

## 17. Ribs and webs (EM)

**Two commands, one step.** Rib takes one run of sketch lines, Web takes a set of them, and both
run in `src/kernel/ribStep.ts`. A rib lies in its sketch plane: the line is the top of the wall, the
thickness is measured across the plane, and the wall grows down the plane's own down direction, so a
line drawn across an inside corner becomes a gusset. A web stands up from its sketch plane: each
line becomes a wall that drops along the plane's normal with the thickness across the line, so lines
drawn over the part, crossing or not, become a set of walls that meet where they cross. Flip turns
either around. Thickness sits either side of the line or on one side of it, and the line's own side
is the sketch normal.

**How far down.** To the Part measures the deepest place the wall lands: a wider copy of the wall is
intersected with the body, the faces of that piece which look back up the wall are found, and the
wall is cut off at the deepest of them. What that leaves buried inside the body costs nothing once
the wall is joined on, and it means a wall that hangs over the edge of the part keeps its full
thickness instead of being sliced away. Distance grows the wall exactly as far as it is told. A wall
that never touches the part is refused by name, and a rib given lines that do not join up says to
use Web.

**Tests.** `?selftest&suite=walls` builds a gusset across a corner, a rib over a step, a rib given a
distance, a wall centred on its line and on each side of it, a web of two crossing lines, and both
refusals, each against a hand calculation.

## 18. Fit test coupon (EM)

**Two cards.** One step in the FIT group (`src/kernel/couponStep.ts`) makes two small bodies to
print: a card with a row of pins, all the nominal size, and a card with a row of holes, each one
step looser than the last. Seven rungs from 0.10 to 0.40 mm of gap per side to start with, all of it
in the panel. Push pin one into hole one and work along until a rung feels right; the number beside
it is that gap in hundredths of a millimetre, which is what the printer fit classes in the
Parameters dialog take (§15).

**Numbers without a font.** The labels are seven-segment digits cut from rectangles, so a coupon
never depends on a font being installed. The bars are deliberately kept apart from each other:
touching rectangles are what replicad's 2D booleans cannot fuse, and one pocket of separate bars
cuts in a single step. `couponLayout` works out the card sizes and where every pin and hole sits,
and the tests use the same function, so the coupon can be laid out again without rewriting them.

**Checks.** The panel and the step both refuse a ladder whose last rung is looser than the pin is
wide. `?selftest&suite=walls` builds a coupon, measures both cards, and pushes probe cylinders a
hair under and a hair over each rung's size into the holes to prove every hole is the pin plus twice
its gap.

## 19. Cable entries (EM)

**One command, four kinds.** Cable Entry sits in the FIT group and is placed by clicking the wall,
like a fit. Grommet Hole cuts a rounded hole of the cable plus its clearance, chamfered on both
sides so a printed edge never bites the lead. Cable Gland cuts the panel hole a screw-in gland
needs, from a table of PG7 to PG16 and M12 to M25 in `src/doc/cables.ts`, with the cable range each
one grips; the panel says so when the cable does not suit the gland picked, and Room for the Nut
clears the space the lock nut needs on the inside. Zip-tie Anchor stands a small bridge on the wall
with a slot under it for a 2.5, 3.6 or 4.8 mm tie. Strain Relief puts two screw posts either side of
the cable and makes a second body, a bar with a groove and two clearance holes, that screws down and
pinches the lead.

**The wall measures itself.** A hole has to know how thick the wall under it is, so
`src/kernel/cableSteps.ts` drops a cylinder the width of the hole down the face normal, intersects
it with the body and takes the near piece: that is the wall, and the chamfers land on its two faces
wherever it sits. Everything else is built in the entry's own frame and placed with one transform,
so an entry works on any flat face at any angle.

**Tests.** `?selftest&suite=cables` cuts each kind into a plate and checks the volume against the
hole and chamfer formulas, proves the nut room never eats the wall, and builds the clamp with its
bar.

## 20. Board clips (EM)

**The board is the input.** Board Clips takes a board already placed in the design and the body the
clips stand on, so the clips read the board's outline and thickness from the catalogue and move with
it, like mounting holes do. It is in the FIT list and on a placed board's right-click menu. Clips go
along the board's two longer edges, two per edge to start with, set in from the corners.

**One profile, four places.** Each clip is a profile drawn in `src/kernel/clipSteps.ts` and swept
across the clip's width: a post standing outside the board edge by the fit gap, a hook that reaches
over the top of the board with a 45 degree lead-in so the board pushes past it, and a ledge under
the board edge to rest on. Where the board already sits on the floor the ledge is left out and the
post starts there. Everything is built in the board's own coordinates and placed with the board's
matrix, so clips follow the board wherever it is put. The floor each clip stands on is found by
dropping a probe under the clip and taking the top of what it hits.

**Tests.** `?selftest&suite=cables` clips a real Raspberry Pi to a plate, checks the hooks finish
exactly a board thickness plus the hook and lead above the floor, that more clips add more material,
and that a step whose board has been deleted says so.

## 21. Screw lid (EM)

**A thread on a face you pick.** Screw Lid takes the round side of an opening, picked near the end
the cap goes on, and gives it a thread. Which end is decided by where the click landed, and Other
End moves it to the far one. The face tells the step everything else: its radius, how long it is,
and whether the material is outside it or inside. A neck gets a male thread and a cap that screws
over it; a bore gets a groove cut into it and a plug that screws in. A thread longer than the face
is a warning, not an error.

**One ridge, swept.** `src/kernel/screwStep.ts` draws the thread as a profile in the XZ plane, a
blunt trapezoid or a vee, and sweeps it along a helix of the chosen pitch. The same ridge makes both
halves: rooted 0.2 mm inside the material and grown by the fit gap on every side when it is the
groove, so the two never touch. The cap is a plain cylinder with the bore and the groove cut out of
it, and the ribbed grip is a knurled ring glued on afterwards. Order matters: cutting a helix out of
a knurled cylinder takes seconds, out of a plain one a few hundred milliseconds, because every face
of the target is intersected against the helical ones.

**The booleans are our own.** replicad simplifies the result of every boolean, which never finishes
on helical faces, so the lid is built with `BRepAlgoAPI_Fuse`/`Cut` directly. The knurl is joined
with `BOPAlgo_GlueFull`, which tells OpenCascade the two only touch along one cylinder and saves it
looking for intersections that are not there.

**Tests.** `?selftest&suite=screw` threads a jar both ways round, screws the cap and the plug into
place and intersects them with the jar to prove nothing touches, builds the vee profile, and checks
the warning when the thread outgrows its face.

## 22. Enclosure (EM)

**Sized by the parts.** Enclosure takes the placed catalogue parts you pick and builds a box round
all of them, so moving a part moves the box: the step lists its parts' occurrences as inputs, and
the prefix cache rebuilds it when one moves. The inside is the parts' combined bounds grown by the
room round them, with the room under them below. A connector you have not ticked for an opening
counts towards the bounds, so the wall clears it; a ticked one does not, so its opening sits right
at the connector's face. It is in the FIT list and on a placed part's right-click menu.

**One step, two bodies.** `src/kernel/enclosureStep.ts` builds everything from boxes and cylinders
in the context's axes, so it never needs a face reference: the walls and floor, then every
addition in one fuse and every cut in one cut. It makes the box and the lid as two new bodies.

- **Screws.** Four towers stand outside the corners, each touching the inside corner at a single
  point so nothing intrudes on the parts, with a pilot hole 0.4 mm under the screw. The lid sits on
  the rim, reaches over the towers, has clearance holes and countersinks, and a thin locating rim
  that drops no further than the room above the parts.
- **Snap.** The same proportions as the shell lid's snap fit (`lidProportions`): a lid flush inside
  the rim, a skirt below it with a bead, a matching groove round the walls, and a notch at one end
  for a fingernail.
- **Slide.** Grooves in three walls and a slot through the fourth; the lid runs in them above the
  room over the parts and stands 2 mm proud of the open end, with a ridge to push on. Walls under
  1.2 mm are refused.

The walls move out as far as the lid's hanging parts and any board clips need, so neither touches
the other or a part.

**Per board.** Each board picks standoffs under its mounting holes, the board clips of §20, or
nothing; a board without holes defaults to clips, and a tilted one gets no mounts and a warning.
Openings reuse the Port Cutouts cutters for the connectors ticked.

**A list input.** The command panel gained a `list` input: rows worked out from the other values,
as buttons per row or as tick boxes, with an All line that sets every row at once. Mounting and
Openings are both lists. The panel itself is now capped to the canvas height and only its body
scrolls, because a long list pushed the footer off screen.

**Tests.** `?selftest&suite=enclosure` boxes a real Raspberry Pi 4 with each lid, intersects the lid
with the box to prove they never overlap, checks that standoffs and clips add material and ticked
connectors remove it, that moving the Pi moves the box by the same amount, that thin walls refuse
a sliding lid, and that a deleted part is reported.

## 23. KiCad board import (EM)

**A board becomes a part.** File > Import KiCad Board reads a `.kicad_pcb` (KiCad 5 `module` files
and KiCad 6 to 8 `footprint` files alike) and saves the result with your own parts, as the same
JSON a catalogue part is. From there it places, clips, gets standoffs and openings, and goes in an
enclosure like any shipped board. The File menu gained an Import section for it, with the mesh
import beside it.

**What comes from the file, and what is guessed.** `src/catalogue/kicad.ts` parses the
S-expressions itself. The outline is the Edge.Cuts drawing: lines, arcs (three-point and the old
centre-and-angle form), rectangles, circles, polygons and curves are chained end to end into loops
and the largest is the board; when it fills its bounding box it is saved as a rectangle with its
arc radius as the corner radius, otherwise as a polygon. Everything is moved so the bottom-left
corner is the origin with Y up, the way datasheets and the catalogue measure. Footprints are placed
with KiCad's own rotation (a positive angle turns anticlockwise on screen). Mounting-hole footprints,
or ones made only of unplated holes of 2 mm and up, become mounting holes with a screw size read
from the name or the drill. Every other footprint becomes a block the size of its courtyard (its
pads when it has none), on top or underneath by its layer. Heights are the one thing a board file
does not have: they are guessed from the footprint name (a height or can size written into it
first, then a table of packages and connectors, then 2 mm), which is why an imported part is
labelled approximate.

**You pick the connectors.** The import dialog lists every footprint, with likely connectors (J
references and anything touching the edge) first, a tick box for each, and its height ready to
change. A ticked footprint becomes a connector on the edge it is nearest, with its width along
that edge and how far it hangs over it, which is all Port Cutouts and Enclosure need.

**Tests.** `?selftest&suite=kicad` reads a KiCad 8 board with a rounded outline drawn from lines and
arcs, four M3 holes, a USB-C hanging off an edge, a pin header turned 90 degrees, a chip, a
capacitor underneath and a resistor with no courtyard, and a KiCad 5 board; checks the outline,
holes, blocks, the rotated footprint's position and the ticked connector; checks the part passes the
catalogue validator; refuses a schematic; and builds an enclosure round the imported board with an
opening for its USB-C.

## 24. How the work is done

- Agents never start other agents or workflows.
- New and rewritten code has no comments. Touched files are formatted with Prettier, and the
  Pages workflow refuses to deploy a tree that `npm run format:check` rejects. `.gitattributes`
  keeps every checkout LF, so the check agrees on Windows and Linux.
- Commits go on `fusion`, in the repo's message style, and are pushed to `fusion`. `main`
  deploys GitHub Pages; it is only ever moved on by merging `fusion` into it, deliberately,
  when the whole suite is green — never committed to directly.
- `src/doc/types.ts`, `src/doc/model.ts`, `src/kernel/types.ts` and `src/main.tsx` are the
  contract. They change only additively, only when work cannot proceed otherwise, and every
  change is listed in the agent's report.
- `?kerneltest` runs the model and kernel tests without the app; `?selftest` runs everything.
  Results are on `window.__okc_tests`. `npm test` builds and runs the same suite headlessly in
  Chromium through `scripts/selftest.mjs`, and the Pages workflow runs it before it deploys.
  A check that cannot run where it finds itself returns `skipped` rather than a false failure.
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
- **J smoke test.** Sketch a circle on the top of a box and extrude it -4 mm: the operation turns to Cut
  and a red pocket shows. Put a Box on the top face with a height of -3 and see it cut too. Start the
  Line tool in a sketch and click Select. Right-click low on the screen and see the list sit beside or
  above the ring. Click Create Sketch and then the XZ plane, finish, click Create Sketch again and
  click the top of a box. Make an Offset Plane 20 mm above XY, sketch on it and extrude, then edit the
  plane to 30 mm and see the extrude follow. Select the top face of a box and press Q: the Press Pull panel pulls it 8 mm with
  the arrow. Select an edge and press Q to get Fillet; select a sketch and press Q to get Extrude.
  Right-click a side face and choose Draft, pick XY as the plane and tilt it 10°. Scale a body by 2.5
  in an inch document and read 2.5, not a length. Open any command and see the Inspector step aside.
  Narrow the window to 950 px and scroll the ribbon. Undo back through every step.
- **P smoke test.** Insert an Arduino Nano and a Raspberry Pi Pico. Select the Nano and untick Pin
  headers: the pins go and the plated holes show. Tick Pin headers on the Pico: male pins appear under
  both long edges. Put a 3 mm plate just under the Nano, run the clearance check with and without its
  headers, and swap the Pico for a Pico 2 to see the pins stay. Undo back through every step.
- **EM smoke test (KiCad import).** Choose File > Import KiCad Board and open a `.kicad_pcb`. The
  dialog shows the board's size, its holes and every footprint, connectors first. Tick the USB
  socket, change a height, and choose Add it to my parts. Open the parts panel: the board is there
  under the kind you picked. Place it, right-click it and choose Enclosure: the ticked socket is in
  the Openings list. Remove the part from Your parts afterwards.
- **EM smoke test (enclosure).** Insert a Raspberry Pi 4, right-click it and choose Enclosure: a box
  with corner towers and a lid appears round it. Tick All connectors, untick Ethernet, and see seven
  openings through the walls. Switch Lid to Snap and the Pi's mounting to Clips, then OK. Hide the
  lid: the Pi sits on its clips inside. Move the Pi 10 mm along X: the box follows. Double-click the
  step and see every choice as you left it. Undo back through every step.
- **EM smoke test (screw lid).** Make a 30 mm tall cylinder of radius 15 and cut a 12 mm bore into
  it. Run Screw Lid from the FIT group and click the outside of the tube near the top: a ribbed cap
  appears over a threaded neck. Change Turns to 4 and Thread Shape to Vee, then OK. Hide the cap and
  the thread is on the jar. Undo back through every step.
- **EM smoke test (clips).** Insert a Raspberry Pi 4 and put a plate under it. Right-click the Pi and
  choose Board Clips: four clips appear along its long edges. Change Clips per Edge to 3 and the fit
  to Sliding, then OK. Move the Pi 5 mm along the plate: the clips follow. Undo back through every
  step.
- **EM smoke test (cables).** On a hollowed box, run Cable Entry and click a wall: a grommet hole
  appears where you clicked. Change Kind to Cable Gland, pick PG9 and read the cable range; set the
  cable to 13 mm and see the panel say the gland does not grip it. Change Kind to Zip-tie Anchor and
  then to Strain Relief: a bar body appears beside the box. Undo back through every step.
- **EM smoke test (coupon).** Run Fit Test Coupon from the FIT group and OK: two cards appear, one
  with seven pins and one with seven holes numbered 10 to 40. Export them as STL, print them, and
  push pin one into hole one and on along the row. Open fx Parameters and type the number that felt
  right into the fit class it belongs to.
- **EM smoke test (ribs).** On a 50 x 30 x 4 mm plate with a 4 mm upright along one edge, sketch on a
  plane through the middle of it and draw one line from the upright down to the plate. Run Rib, pick
  the line and the body, set 4 mm and OK: a gusset fills the corner. Double-click it, switch Depth to
  Distance and watch it stop short. On the same plate sketch two crossing lines on a plane above it,
  run Web with 2 mm and OK: two walls stand on the plate and meet. Undo back through every step.
- **EM smoke test.** Sketch on the top of a 60 x 40 x 10 mm block, click Text, click near a corner and
  type a word; pick a font and a height of 8 mm and OK. Finish the sketch, run Emboss, click the text
  and the top face, set 1 mm and OK: the letters stand on the block. Double-click the step, switch it
  to Deboss and OK. Make a 24 mm rod 40 mm tall, sketch on XZ, put text on it and emboss it 1 mm: the
  letters wrap round the side. Double-click the text in the sketch, change the words and see the
  emboss follow. Undo back through every step.
- **FT smoke test.** Make a 60 x 40 x 2 mm plate and a 60 x 40 x 25 mm box standing on it, hollow the
  box through its bottom face and hide it. Choose Snap Fit and click the plate near an edge: the arm
  stands against the box's wall with the hook pointing into it and Other Part filled in. OK, show the
  box and use Section across the arm to see the hook in its catch. Edit the fit, make the arm 6 mm and
  read the crack warning. Put two plates side by side 0.6 mm apart, choose Print-in-place Hinge and
  click one of them near the gap: the line lands in the gap. Open fx Parameters, set Snug to 0.25,
  press Use these gaps in this design and Apply: the snap fit rebuilds with a 0.25 mm gap. Shell a
  60 x 40 x 30 mm box through its top with Make a Lid set to Hinged and see the fit move to Loose and
  the knuckles run along the back edge. Double-click the lid on the timeline, switch it to Snap hooks
  and see the seat step renamed Catches for the lid. Undo back through every step.
