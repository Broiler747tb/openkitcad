# OpenKitCAD 0.5 — sketch workshop

## Where to find it

Edit a sketch: the right panel now opens with **Sketch workshop**. Pointer coordinate input and the original dimensions/constraints panel are collapsible below it. New creation and copy commands are also searchable with **S** and appear in sketch toolbar menus.

## Precision creation

- Line from a start point, length and angle.
- Centred rectangle with width, height and rotation.
- Circle by diameter.
- Concentric ring with outer/inner diameters.
- Editable X/Y creation centre, also used as the copy pivot.
- Exact shapes start fixed. Unfix removes point Fix and circle Radius constraints, not other dimensions. The sketch origin always remains fixed.
- Polar coordinate placement: distance and angle, absolute or relative to the previous drawing point.

## Copy and selection

- Translated copies with independent X/Y steps and copy count.
- Rotated copies with angle step, pivot and copy count.
- Uniform scaled copy about a specified pivot.
- Copies are independent/unconstrained; originals are unchanged. Shared vertices remain shared inside each copy. Count excludes originals. Up to 100 copies and 500 copied entities per operation.
- Select all, none, invert; select lines, circles, arcs, construction or profile edges.
- Ctrl+A selects all sketch edges; Ctrl+Shift+I inverts edge selection outside input fields.
- Fix/unfix selection, convert selection to construction/profile edges, batch delete.
- Remove unused points (constraint-referenced points are retained).
- Selected total curve length, edge count and selected count.

## Dimensions and scene

- Parameter dialogs and coordinate fields accept arithmetic, parentheses, pi and scientific notation. No JavaScript execution.
- Lengths accept mm, cm, m, in; angles accept deg or rad. Examples: `1in`, `25.4/2`, `(pi/2)rad`.
- Results are evaluated once, not persistent expressions or named parameter links.
- Scene panel: show all, hide all, invert visibility, isolate selected body/part. Undo restores previous visibility.
- Geometry and visibility edits support normal Undo/Redo. Invalid dialog input leaves the document unchanged.

## Verification

`npm run typecheck`, `npm run build`, and `?selftest` (309 assertions including 36 workshop checks). Browser smoke test: ring with 1in outer diameter and 10/2 inner diameter; three translated copies; single-step Undo.
