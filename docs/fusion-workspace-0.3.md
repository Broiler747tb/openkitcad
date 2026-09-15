# OpenKitCAD 0.3: Fusion-inspired Design workflow

The interface follows the supported Design/Sketch workflow of Fusion, while retaining OpenKitCAD branding, its local document format and its existing CAD kernel. It is not a full Fusion implementation.

## Workspace

- Compact file/quick-access bar and Solid/Sketch context strip.
- Create, Modify, Assemble, Construct, Inspect and Insert command groups.
- Floating Browser with bodies, origin-plane sketch entry points and catalogue components.
- Contextual properties and Sketch Palette on the right.
- Feature timeline grouped by body, with selection, double-click editing, suppression and keyboard navigation. It reflects each body's existing evaluation order, not a global chronological rollback timeline.
- Light canvas, navigation bar and exact-parameter command dialogs.

## Actions

Commands such as Extrude, Fillet and Move can be chosen before an object. A persistent prompt asks for the needed selection; Escape cancels it. Finishing a sketch retains profile selection so E can immediately extrude a closed outline. Move accepts X/Y/Z distances in one operation and creates no feature on Cancel or zero displacement. Inspector values commit on Enter or blur, not every keystroke.

## Keyboard / mouse

Based on the [Autodesk Fusion keyboard reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GUID-F0491540-0324-470A-B651-2238D0EFAC30.htm).

| Key | Operation |
| --- | --- |
| S | Command toolbox; search then Enter, or navigate results with arrows |
| E / F / H / M | Extrude / Fillet / Hole / Move |
| I / V / A | Measure / visibility / body display colour |
| L / R / C / D | Line / rectangle / circle / dimension in Sketch |
| O / X / T | Offset / construction / trim on applicable selected sketch geometry |
| Ctrl+B | Compute all |
| Ctrl+N / O / S | New / open / save |
| Ctrl+Z / Y | Undo / redo |
| Ctrl+C / X / V | Copy / cut / paste outside Sketch |
| Ctrl+Alt+B | Toggle Browser |
| Escape | Cancel current tool or selection |
| Home | Fit view (OpenKitCAD extension) |
| Middle drag / Shift+middle drag / wheel | Pan / orbit / zoom |

Letter keys use physical key codes, including with a non-Latin keyboard layout. Modelling shortcuts do not run in text/number inputs or open dialogs. F no longer means Fit, S no longer means Select, and A no longer means Arc.

## Limits

Q (Press Pull), J (joints), P (projection), CAM and surface workspaces are not implemented or mapped to unrelated operations. H creates XY-normal holes using world coordinates (or board-derived mounting holes for a selected component). A sets display colour, not physical material properties. Construct offers sketches on origin, offset and tilted planes; there is no separate construction-plane feature. Trim requires applicable selected geometry; this is not Fusion's continuous trim brush. Dialogs apply on OK; they do not preview live geometry.

## Verification

- TypeScript and production build passed.
- Self-test: **253/253**, including 10 new workflow regression checks.
- Browser checks: S/search/Enter, F, R, Finish Sketch → E, exact Move and command-before-selection, timeline editing, suppression/unsuppression, Escape.
- Desktop layout visually inspected at 1280×720.
- Native pointer orbit behaviour is configured from OrbitControls' documented implementation; native EXE interaction was not manually tested.

The Windows x64 portable build includes the catalogue and OpenCascade WASM locally. Build on C: when X: rejects Electron's temporary directory rename; no runtime web server is needed. The executable has no publisher signature.
