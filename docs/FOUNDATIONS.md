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
instance they overlap, in world space. Pairs whose world bounding boxes do not intersect are
skipped. A cut instance gets its own mesh key, `hash(mesh key, instance matrix, cutter keys and
matrices)`; an uncut instance keeps the shared key.

**Preview.** `preview({ doc, features, insertAt, replaceFeatureId })` evaluates
`timeline[0..insertAt)` plus the pending features, replacing `replaceFeatureId` when given, and
nothing after, the way Fusion rolls the timeline back while a feature is being edited. It uses the
same cache, returns a full `EvaluateResult` with every instance flagged `preview`, and never
changes what the next `evaluate` returns.

**Exports and checks** take instance ids and work on world-space shapes: `exportStep`, `meshOf`,
`project`, `printPrep`, `distanceBetween`. `clearance` checks catalogue keepouts and instance
overlaps across the whole assembly.

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

## 7. Command panel and timeline (F3)

Commands are declarative: an id, a label, a hint, typed inputs (selection with a filter and a
count, length, angle, integer, choice, toggle) and a pure `build(values) => Feature[]`. The panel
floats at the top right of the canvas, drags and collapses to its title bar, with OK and Cancel
at the bottom; Enter commits and Escape cancels. Every input change requests a debounced preview,
and the viewport shows the preview scene until the command closes. Lengths get a drag arrow in the
viewport with a value box beside it. Editing a feature opens its command with its values and
previews with `replaceFeatureId`.

The timeline gets a draggable marker, reordering validated by `canMoveFeature`, contiguous
groups, and a context menu with Edit, Suppress, Roll Back To Here, Group and Delete.

## 8. How the work is done

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
