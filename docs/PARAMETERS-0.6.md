# OpenKitCAD 0.6 — persistent parameters (PC)

Open **fx Parameters** in the top bar, or search for **User parameters** with S.

1. Create a box using CREATE → Add a box.
2. Add parameters `width = 80`, `depth = width/2`, `wall = 3`.
3. Add dimension links: box width → `width`, depth → `depth`, height → `wall`.
4. Apply & rebuild. Changing width to 100 also changes depth to 50.
5. Undo/Redo restores expressions and links along with geometry. Save to `.okc` to retain them.

Expressions support +, -, *, /, parentheses, pi and mm/cm/m/in suffixes. Names are lowercase letters, digits and underscores, starting with a letter or underscore. References may point to later rows. Cycles, missing references, duplicate names and invalid linked dimensions prevent Apply without changing the document.

Numeric edits through Properties detach the explicitly edited fields. Unlink retains the last applied numeric value. Rename parameter references manually when renaming a parameter. Deleting a feature removes its dimension links.

## Scope and limitations

This is a step toward parametric CAD, not Fusion 360 feature parity. Links currently support exposed top-level numeric feature dimensions (including primitive sizes, extrusion distance and supported hole/fillet/shell dimensions). Sketch constraints, component catalogue dimensions and nested transform/pattern fields are not linked yet.

Parameters are scalars in model millimetres, not dimensionally typed quantities. Angle links interpret scalar values as degrees and accept deg/rad suffixes directly in the link expression. Geometric feasibility still depends on the modelling kernel; valid arithmetic does not guarantee that a fillet or boolean operation can be built.

`.okc` remains version 1 with additive expression/binding fields and resolved numeric values. Older application builds can display cached sizes but do not maintain the new dependencies. Use 0.6 or newer to edit linked designs.

## Verification

- TypeScript and production build passed.
- Browser selftest: 328/328 checks passed, including 19 parameter tests.
- UI check: linked box width changed from 40 to 80 mm; volume changed from 24 to 48 cm³.
- Portable PC build includes the geometry engine; no Android rebuild in this milestone.
