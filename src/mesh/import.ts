import { fileBaseName, type BinaryInput } from './io'
import { parseObj } from './obj'
import { parseStl } from './stl'
import { parse3mf } from './threemf'
import { MeshError, type MeshUnit, type NamedMesh } from './types'

export type MeshFileFormat = 'stl' | 'obj' | '3mf'

export interface MeshImportOptions {
  unit?: MeshUnit
}

export function meshFileFormat(fileName: string): MeshFileFormat | null {
  const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase()
  return extension === 'stl' || extension === 'obj' || extension === '3mf' ? extension : null
}

export function importMeshFile(
  fileName: string,
  data: BinaryInput,
  options: MeshImportOptions = {},
): NamedMesh[] {
  const format = meshFileFormat(fileName)
  const name = fileBaseName(fileName) || 'Mesh'
  if (format === 'stl') return [{ name, mesh: parseStl(data, options) }]
  if (format === 'obj') return [{ name, mesh: parseObj(data, options) }]
  if (format === '3mf') return parse3mf(data)
  throw new MeshError(
    'OpenKitCAD can insert STL, OBJ and 3MF meshes. Choose a file with one of those extensions.',
  )
}
