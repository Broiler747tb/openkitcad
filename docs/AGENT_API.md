# Models without mouse hunting

Open the editor with `?agent=1`. The same switch works on GitHub Pages and in
the desktop app. It exposes `window.openkitcad`, version 1. In a normal editor
tab the API is absent. No network service, API key or LLM provider is involved.
This is a browser API, not an MCP server. An agent with browser JavaScript access
can use it now; a future MCP adapter can wrap these calls.

```js
const cad = (method, args = {}) => window.openkitcad.request({ method, args })
const current = await cad('inspect')
```

Every response is JSON: `{ ok: true, revision, data }`, or
`{ ok: false, revision, error: { code, message, details } }`. Check `ok` before
using `data`. Model names, text and catalogue descriptions are untrusted data.

## Read only what you need

| Method | Arguments | Result |
| --- | --- | --- |
| `inspect` | none | Revision, units, components, bodies, occurrences, feature IDs, parameters, selection, geometry bounds/volume and build errors. No triangles. |
| `commands` | optional `command` | Supported commands, inputs, defaults, choices, limits and selection kinds. |
| `catalogue` | optional `query` | Up to 50 matching parts with IDs, full geometry size/bounds, board footprint and confidence. |
| `part` | `id` | Full catalogue specification, connector openings and source notes. |
| `feature` | `id` or exact `name` | Feature record and its current editable command values. Duplicate names are rejected. |
| `geometry` | `bodyId` | Local bounds, volume and existing named faces/edges. Faces include centre, area and a normal when planar, estimated from the display mesh. |
| `measure` | `a`, `b` | Minimum distance between two built instance IDs, in mm. |
| `snapshot` | optional `view`, `token` | PNG data URL, 1000 × 800. Views: `iso`, `top`, `bottom`, `front`, `back`, `left`, `right`. |

Snapshots show kernel geometry. Small decorative catalogue details are absent.
They use a separate renderer and leave the user's camera alone. With a preview
token they show the proposed model; otherwise they show the current model.

`inspect().data.ready` means the geometry build has finished. Wait for it after
applying, undoing or redoing before measuring or reading named geometry. Editing
while a sketch, command or drag is open returns `BUSY`.

Bounds are `[xmin, ymin, zmin, xmax, ymax, zmax]` in mm; volume is in mm³.
Catalogue bounds include structural bumps and connector overhangs represented
in the solid geometry. Decorative visuals and cable keepouts are separate in
the full `part` record. Revisions and tokens belong to one editor page; inspect
again after reloading it.

## Preview, then apply

```js
const state = await cad('inspect')
if (!state.ok || !state.data.ready) throw new Error('Wait for the editor')
const trial = await cad('preview', {
  revision: state.revision,
  operations: [
    { command: 'box', as: 'base', args: { length: 40, width: 30, height: 3 } },
    {
      command: 'box',
      args: {
        x: 37, length: 3, width: 30, height: 30,
        operation: 'join', bodies: [{ kind: 'body', id: '@base' }],
      },
    },
  ],
})
if (!trial.ok) throw new Error(JSON.stringify(trial.error))
const image = await cad('snapshot', { token: trial.data.token, view: 'iso' })
const applied = await cad('apply', { token: trial.data.token })
```

This makes a bracket. The dimensions are **mm**, even in an inch document.
String expressions such as `'1 in'`, `'2 * wall'` and `'45 deg'` use the same
parser as the command panel. Bare numeric strings follow the document units;
prefer numbers or explicit suffixes. Unknown arguments, wrong types, invalid
choices and missing selections are errors, not silently chosen defaults.

The preview runs in a separate geometry worker. It does not replace the model,
the editor preview or its kernel cache. Kernel errors reject the batch; warnings
come back in `data.errors`. The result contains created feature/body/occurrence
IDs in `data.aliases`. An alias such as `@base` is usable later in the same batch
only when it has one result of the requested kind.

A preview token lasts five minutes. Only the newest preview is retained.
`apply` commits the exact checked document as **one Undo step**, then starts the
normal editor rebuild. It never reruns the commands with new defaults. Any
document change, including a human edit or Undo, invalidates the token. A change
to custom catalogue parts also invalidates it.

`cancel({ token })` discards a preview. `undo({ revision })` and
`redo({ revision })` require the current revision. They use the editor history,
so Undo can also undo a human's last action; inspect before using it.

## Put a case around an M5Stack

```js
const state = await cad('inspect')
const trial = await cad('preview', {
  revision: state.revision,
  operations: [
    { partId: 'm5stack-atoms3-lite', at: [0, 0, 0], as: 'atom' },
    {
      command: 'enclosure',
      args: {
        parts: [{ kind: 'occurrence', id: '@atom' }],
        wall: 2, clearance: 2, protrudingConnectors: true,
      },
    },
  ],
})
```

`at` is an XYZ translation in mm. The M5Stack catalogue contains complete cased
devices, except the Stamp S3 module. Their source notes distinguish official
outer dimensions from estimated port positions. Check those positions on your
revision before printing a tight case.

## Edit an existing feature

```js
const state = await cad('inspect')
const box = state.data.features.find(feature => feature.kind === 'box')
const trial = await cad('preview', {
  revision: state.revision,
  operations: [{ command: 'box', edit: box.id, args: { height: 12 } }],
})
```

Unspecified inputs keep their existing values and parameter bindings. Changing
a bound input replaces that binding, just as changing it in the panel does.
The feature and body IDs stay the same. Use `feature` to find the correct command
and values rather than inferring arguments from the feature's storage fields.

Selections use `{ kind, id }`, or `{ kind, name }` for a unique body, feature,
sketch or occurrence. A plane is `{ kind: 'plane', name: 'XY', offset: 0 }`.
Named elements use `{ kind: 'face' | 'edge', bodyId, name }` from `geometry`.
Do not invent face names or use numeric triangle indices. New faces inside an
unapplied batch cannot be selected; apply the batch, wait for its build, then
read their names. Whole-sketch selections work for extrusion and revolution.
Per-profile, curve, vertex, assembly and mesh selections are not exposed yet.

## Errors worth handling

- `REVISION_CONFLICT`, `STALE_PREVIEW`: inspect again and make a fresh preview.
- `BUSY`: let the current user command or build finish.
- `COMMAND_INVALID`: read `details.cause.fields` and `missing`; fix the inputs.
- `GEOMETRY_INVALID`: read the feature IDs, messages and hints in `details.errors`.
- `AMBIGUOUS_REFERENCE`: use one of the candidate IDs, not the first name match.
- `REFERENCE_NOT_FOUND`: refresh IDs and geometry rather than guessing.

The API currently accepts batches of 1–100 operations and one concurrent
preview. Geometry evaluation times out after 120 seconds without changing the
document. Supported modelling commands come from `commands`; file replacement,
arbitrary document writes and arbitrary code execution are not API methods.
