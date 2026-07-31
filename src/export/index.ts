/**
 * Export orchestration: pick a format, get a file.
 */
import { kernel } from '../kernel/api'
import type { ExportFormat } from '../kernel/types'
import { downloadBlob } from '../doc/persist'
import {
  meshTo3MF,
  meshToBinarySTL,
  projectionToDXF,
  projectionToSVG,
} from './formats'
import { projectionToDrillTemplatePDF } from './pdf'

export interface ExportTarget {
  id: string
  name: string
}

export const EXPORT_FORMATS: Array<{
  id: ExportFormat
  label: string
  detail: string
  extension: string
}> = [
  { id: 'stl', label: 'STL', detail: '3D printing. Understood by every slicer.', extension: 'stl' },
  { id: '3mf', label: '3MF', detail: '3D printing, but carries real units so nothing gets mis-scaled.', extension: '3mf' },
  { id: 'step', label: 'STEP', detail: 'Editable solid for FreeCAD, Fusion, SolidWorks.', extension: 'step' },
  { id: 'dxf', label: 'DXF', detail: 'Flat outline for a laser cutter or CNC.', extension: 'dxf' },
  { id: 'svg', label: 'SVG', detail: 'Flat outline for vector software and some cutters.', extension: 'svg' },
  { id: 'pdf', label: 'Drill template', detail: 'Print at 100%, tape to the part, punch and drill.', extension: 'pdf' },
]

function filename(name: string, extension: string): string {
  const safe = name.replace(/[^\w\-. ]+/g, '_').trim() || 'part'
  return `${safe}.${extension}`
}

export async function exportShape(
  format: ExportFormat,
  target: ExportTarget,
): Promise<void> {
  const api = kernel()

  switch (format) {
    case 'step': {
      const buffer = await api.exportStep([target.id], target.name)
      downloadBlob(new Blob([buffer], { type: 'application/step' }), filename(target.name, 'step'))
      return
    }
    case 'stl':
    case 'stl-ascii': {
      const mesh = await api.meshOf(target.id)
      const buffer = meshToBinarySTL(mesh, target.name)
      downloadBlob(new Blob([buffer], { type: 'model/stl' }), filename(target.name, 'stl'))
      return
    }
    case '3mf': {
      const mesh = await api.meshOf(target.id)
      const zip = meshTo3MF(mesh, target.name)
      downloadBlob(
        new Blob([zip as BlobPart], { type: 'model/3mf' }),
        filename(target.name, '3mf'),
      )
      return
    }
    case 'dxf': {
      const projection = await api.project(target.id, 'XY')
      downloadBlob(
        new Blob([projectionToDXF(projection)], { type: 'image/vnd.dxf' }),
        filename(target.name, 'dxf'),
      )
      return
    }
    case 'svg': {
      const projection = await api.project(target.id, 'XY')
      downloadBlob(
        new Blob([projectionToSVG(projection)], { type: 'image/svg+xml' }),
        filename(target.name, 'svg'),
      )
      return
    }
    case 'pdf': {
      const projection = await api.project(target.id, 'XY')
      const pdf = projectionToDrillTemplatePDF(projection, {
        title: `${target.name} - drill template`,
      })
      downloadBlob(
        new Blob([pdf as BlobPart], { type: 'application/pdf' }),
        filename(target.name, 'pdf'),
      )
      return
    }
  }
}
