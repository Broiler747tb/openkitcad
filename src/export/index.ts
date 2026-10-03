import type { ExportFormat } from '../kernel/types'
export { exportShape, exportShapes, prepareExport, filename } from './multiple'
export type { ExportTarget, ExportFile } from './multiple'

export const EXPORT_FORMATS: Array<{
  id: ExportFormat
  label: string
  detail: string
  extension: string
}> = [
  { id: 'stl', label: 'STL', detail: '3D printing. Understood by every slicer.', extension: 'stl' },
  {
    id: '3mf',
    label: '3MF',
    detail: '3D printing, but carries real units so nothing gets mis-scaled.',
    extension: '3mf',
  },
  {
    id: 'obj',
    label: 'OBJ',
    detail: 'Mesh for rendering, games and most other 3D software.',
    extension: 'obj',
  },
  {
    id: 'step',
    label: 'STEP',
    detail: 'Editable solid for FreeCAD, Fusion, SolidWorks.',
    extension: 'step',
  },
  { id: 'dxf', label: 'DXF', detail: 'Flat outline for a laser cutter or CNC.', extension: 'dxf' },
  {
    id: 'svg',
    label: 'SVG',
    detail: 'Flat outline for vector software and some cutters.',
    extension: 'svg',
  },
  {
    id: 'pdf',
    label: 'Drill template',
    detail: 'Print at 100%, tape to the part, punch and drill.',
    extension: 'pdf',
  },
]
