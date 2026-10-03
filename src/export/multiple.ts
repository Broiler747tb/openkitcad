import { zipSync } from 'fflate'
import { kernel } from '../kernel/api'
import type { ExportFormat, KernelApi } from '../kernel/types'
import { downloadBlob } from '../doc/persist'
import { useStore } from '../doc/store'
import { meshesTo3MF, meshToBinarySTL, projectionToDXF, projectionToSVG } from './formats'
import { projectionToDrillTemplatePDF } from './pdf'
import { writeObj } from '../mesh/obj'
import { createMesh } from '../mesh/types'

export interface ExportTarget {
  id: string
  name: string
}
export interface ExportFile {
  name: string
  blob: Blob
}

export function filename(name: string, extension: string): string {
  let safe =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || 'part'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`
  return `${safe}.${extension}`
}

export async function prepareExport(
  format: ExportFormat,
  targets: ExportTarget[],
  name: string,
  api: Pick<KernelApi, 'meshOf' | 'exportStep' | 'project'> = kernel(),
): Promise<ExportFile> {
  const unique = [...new Map(targets.map((target) => [target.id, target])).values()]
  if (!unique.length) throw new Error('Select at least one body to export.')
  if (format === 'step')
    return {
      name: filename(name, 'step'),
      blob: new Blob(
        [
          await api.exportStep(
            unique.map((target) => target.id),
            name,
          ),
        ],
        { type: 'application/step' },
      ),
    }
  if (format === '3mf') {
    const parts = []
    for (const target of unique)
      parts.push({ mesh: await api.meshOf(target.id), name: target.name })
    return {
      name: filename(name, '3mf'),
      blob: new Blob([meshesTo3MF(parts, name) as BlobPart], { type: 'model/3mf' }),
    }
  }
  const files: Record<string, Uint8Array> = Object.create(null)
  const used = new Set<string>()
  let single: ExportFile | undefined
  for (const target of unique) {
    let blob: Blob
    let extension: string
    if (format === 'stl' || format === 'stl-ascii') {
      extension = 'stl'
      blob = new Blob([meshToBinarySTL(await api.meshOf(target.id), target.name)], {
        type: 'model/stl',
      })
    } else if (format === 'obj') {
      extension = 'obj'
      const mesh = await api.meshOf(target.id)
      blob = new Blob(
        [writeObj(createMesh(mesh.vertices, mesh.triangles), { name: target.name })],
        { type: 'model/obj' },
      )
    } else {
      const projection = await api.project(target.id, 'XY')
      extension = format
      blob =
        format === 'dxf'
          ? new Blob([projectionToDXF(projection)], { type: 'image/vnd.dxf' })
          : format === 'svg'
            ? new Blob([projectionToSVG(projection)], { type: 'image/svg+xml' })
            : new Blob(
                [
                  projectionToDrillTemplatePDF(projection, {
                    title: `${target.name} - drill template`,
                  }) as BlobPart,
                ],
                { type: 'application/pdf' },
              )
    }
    let file = filename(target.name, extension)
    let suffix = 2
    while (used.has(file.toLowerCase())) file = filename(`${target.name} (${suffix++})`, extension)
    used.add(file.toLowerCase())
    single = { name: file, blob }
    if (unique.length > 1) files[file] = new Uint8Array(await blob.arrayBuffer())
  }
  return unique.length === 1
    ? single!
    : {
        name: filename(name, 'zip'),
        blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }),
      }
}

export async function exportShapes(format: ExportFormat, targets: ExportTarget[]): Promise<void> {
  if (!targets.length) throw new Error('Select at least one body to export.')
  const snapshot = useStore.getState()
  if (snapshot.building || snapshot.errors.some((error) => error.severity === 'error'))
    throw new Error('Fix the failed steps before exporting.')
  const name = targets.length === 1 ? targets[0].name : snapshot.doc.name
  snapshot.setBusy(`Writing the ${format.toUpperCase()} file`)
  try {
    const file = await prepareExport(format, targets, name)
    if (useStore.getState().doc !== snapshot.doc || useStore.getState().building)
      throw new Error('The design changed during export. Try again.')
    downloadBlob(file.blob, file.name)
  } finally {
    useStore.getState().setBusy(null)
  }
}

export function exportShape(format: ExportFormat, target: ExportTarget): Promise<void> {
  return exportShapes(format, [target])
}
