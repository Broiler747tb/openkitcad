# Precision tools — 0.4

## Grid and snapping

Open **Grid settings** in the bottom navigation bar. Grid visibility and grid snapping also have independent quick toggles.

- Grid spacing: 0.01–1000 mm, including fractional values; presets 0.1 / 0.5 / 1 / 5 / 10 mm.
- Grid extent, major-line interval, contrast and axis visibility.
- Independent endpoint/centre, midpoint, edge and horizontal/vertical inference switches.
- Snap radius in screen pixels, so the capture distance is stable across zoom levels.
- Translation and rotation increments for drag gizmos; zero disables the increment.
- Preferences persist locally, separately from document history. Reset defaults restores the original settings.

The grid is aligned with the active sketch plane, including offset and tilted planes; outside Sketch it uses world XY. Dense grids are visually decimated to keep rendering bounded; the actual snapping interval is not changed and the settings panel explains this.

Geometry snapping takes priority over grid rounding. To work only on the grid, turn off the geometry/inference switches. Hold **Alt** while clicking or dragging sketch points to bypass snapping temporarily. Existing solver constraints can still prevent a dragged point from reaching the requested coordinate.

## Exact sketch construction

The Sketch Palette includes **Precision construction**:

1. Choose Line, Rectangle, Circle or Arc.
2. Enter X/Y in sketch-plane millimetres, then choose **Place exact point**.
3. Supply the remaining points for that tool. Relative mode offsets from the previous point of the current drawing chain; with no previous point it uses the origin.

Exact input bypasses snapping. A rectangle uses opposite corners; a circle uses its centre and a point on its circumference. Keyboard Escape still ends a drawing chain or returns to Select when the canvas has focus.

The same panel exposes existing kernel tools more directly: polygon and rounded slot at absolute X/Y, linear/circular patterns, mirrors, and selection of all sketch entities. Polygon/slot controls appear with no geometry selected; pattern/mirror controls appear for applicable selections. These commands reuse the existing constraint-aware operations and Undo history.

## Checks

- TypeScript and production build passed.
- 263/263 self-tests, including 10 new snapping/preference regression checks.
- Browser: fractional grid settings survive reload; exact rectangle 40×30 mm extrudes to 40×30×3 mm (3.6 cm³); polygon and linear-pattern controls were exercised.
- Native EXE interactive testing is separate from these browser checks.
