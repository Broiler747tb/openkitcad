# OpenKitCAD 0.2 workspace redesign

## Workflow

- **Create**: add a solid with explicit dimensions, start a sketch on a named plane, or open Hardware.
- **Modify & assemble**: select a body or hardware part first. The ribbon shows applicable operations; All actions and the inspector expose the full list.
- **Inspect**: measure, section, and run design checks.
- **Ctrl K**: search commands for the current selection and editing mode.
- Numeric operations use Apply / Cancel dialogs. Inspector fields commit on Enter or blur, not on each keystroke.
- Finish sketch leaves the outline available in the model tree. Select a closed outline to Extrude; use the pencil to edit it again.
- Hardware-derived mounting operations explicitly ask which body to modify.
- Creating a primitive or a standalone sketch is one undo step. History navigation clears stale selections.

## Validation (2026-09-11)

- TypeScript: passed.
- Production Vite build: passed.
- Browser self-test: PASS 243/243, including solver, geometry, mounting holes and STEP export.
- Browser interaction checks: primitive dimensions, sketch extrusion, undo/redo, ES3C28P hardware placement/category, mounting target dialog/cancel, command filtering and Escape.
- Visual inspection: 1280 × 720 desktop viewport.

## Portable build

`npm run dist:portable` produces the Windows x64 portable executable with local JS, catalogue and OpenCascade WASM assets. No web server is required at runtime.

On the current X: workspace volume, Electron extraction failed while renaming its temporary directory. Building to a local C: output directory succeeds:

```powershell
npm run build
npx electron-builder --win portable --x64 --config.directories.output=C:/Users/Daniil/AppData/Local/Temp/OpenKitCAD-0.2.0-build
```

The executable is not publisher-signed. Browser validation is separate from native EXE interaction testing.
