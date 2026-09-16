import {
  expandInstances,
  findOccurrence,
  invertRigidMatrix,
  multiplyMatrices,
  pathKey,
  pathMatrix,
} from '../doc/model'
import type { Matrix4, OkcDocument } from '../doc/types'
import { frameDistance } from './frames'
import type { AssemblyData, AssemblySolveInput, AssemblySolveResult } from './types'

export function assemblyInputFromDocument(
  doc: OkcDocument,
  data: Partial<AssemblyData>,
): AssemblySolveInput {
  return {
    ...data,
    occurrences: expandInstances(doc).map((instance) => ({
      path: instance.path,
      transform: instance.matrix,
      grounded:
        instance.path.length === 0 ||
        !!findOccurrence(doc, instance.path[instance.path.length - 1])?.grounded,
    })),
  }
}

export interface OccurrenceUpdates {
  transforms: Record<string, Matrix4>
  divergent: string[]
}

function differs(a: Matrix4, b: Matrix4): boolean {
  const distance = frameDistance(a, b)
  return distance.translation > 1e-9 || distance.angle > 1e-12
}

export function occurrenceUpdatesFromSolve(
  doc: OkcDocument,
  result: AssemblySolveResult,
): OccurrenceUpdates {
  const locals = new Map<string, Matrix4[]>()
  for (const [key, world] of Object.entries(result.transforms)) {
    if (key === 'root') continue
    const path = key.split('/')
    const parentPath = path.slice(0, -1)
    const parent = result.transforms[pathKey(parentPath)] ?? pathMatrix(doc, parentPath)
    if (!parent) continue
    const id = path[path.length - 1]
    const list = locals.get(id) ?? []
    list.push(multiplyMatrices(invertRigidMatrix(parent), world))
    locals.set(id, list)
  }
  const transforms: Record<string, Matrix4> = {}
  const divergent: string[] = []
  for (const [id, list] of locals) {
    const occurrence = findOccurrence(doc, id)
    if (!occurrence) continue
    const changed = list.filter((local) => differs(local, occurrence.transform))
    if (!changed.length) continue
    if (changed.length !== list.length || changed.some((local) => differs(local, changed[0]))) {
      divergent.push(id)
    }
    transforms[id] = changed[0]
  }
  return { transforms, divergent }
}
