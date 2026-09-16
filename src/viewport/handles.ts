import { v3, type Vec3 } from '../core/math'
import { transformDirection, transformPoint } from '../doc/model'
import { componentMatrix } from '../doc/store'
import type { OkcDocument } from '../doc/types'
import type { BodyMesh, Instance } from '../kernel/types'
import type { CommandSession } from '../ui/command/session'
import { evaluateCommand, findInput } from '../ui/command/state'
import type { CommandHandle } from '../ui/command/types'
import type { WorldHandle } from './engine'

export interface ActiveHandle extends WorldHandle {
  input: string
  inputKind: 'length' | 'angle'
  scale: number
}

function edgeAnchor(
  edge: { bodyId: string; name: string },
  instances: readonly Instance[],
  meshes: ReadonlyMap<string, BodyMesh>,
): { origin: Vec3; direction: Vec3 } | null {
  const instance = instances.find(
    (candidate) => candidate.bodyId === edge.bodyId && !candidate.previewTool,
  )
  const mesh = instance ? meshes.get(instance.meshKey) : undefined
  const group = mesh?.edges.edgeGroups.find((candidate) => candidate.name === edge.name)
  if (!instance || !mesh || !group || group.count === 0) return null
  const sum: Vec3 = [0, 0, 0]
  for (let i = group.start; i < group.start + group.count; i++) {
    sum[0] += mesh.edges.lines[i * 3]
    sum[1] += mesh.edges.lines[i * 3 + 1]
    sum[2] += mesh.edges.lines[i * 3 + 2]
  }
  const middle = v3.scale(sum, 1 / group.count)
  const [x0, y0, z0, x1, y1, z1] = mesh.bounds
  const outward = v3.sub(middle, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
  if (v3.len(outward) < 1e-9) return null
  return {
    origin: transformPoint(instance.matrix, middle),
    direction: v3.norm(transformDirection(instance.matrix, v3.norm(outward))),
  }
}

export function resolveHandles(
  session: CommandSession,
  doc: OkcDocument,
  instances: readonly Instance[],
  meshes: ReadonlyMap<string, BodyMesh>,
): ActiveHandle[] {
  const { spec, state, context } = session
  if (!spec.handles) return []
  const evaluation = evaluateCommand(spec, state, context)
  let declared: CommandHandle[]
  try {
    declared = spec.handles(evaluation.values as never, context)
  } catch {
    return []
  }
  return declared.flatMap((handle, index): ActiveHandle[] => {
    const input = findInput(spec, handle.input)
    const value = evaluation.values[handle.input]
    if (!input || (input.kind !== 'length' && input.kind !== 'angle')) return []
    if (evaluation.hidden.includes(input.id) || typeof value !== 'number') return []
    const id = `${handle.input}#${index}`
    const matrix = componentMatrix(doc, handle.componentId)
    if (handle.kind === 'arc') {
      return [
        {
          id,
          kind: 'arc',
          origin: transformPoint(matrix, handle.centre),
          direction: v3.norm(transformDirection(matrix, handle.axis)),
          start: v3.norm(transformDirection(matrix, handle.start)),
          radius: handle.radius,
          length: value,
          input: handle.input,
          inputKind: 'angle',
          scale: 1,
        },
      ]
    }
    const scale = handle.scale ?? 1
    const anchor =
      'edge' in handle.anchor
        ? edgeAnchor(handle.anchor.edge, instances, meshes)
        : {
            origin: transformPoint(matrix, handle.anchor.point),
            direction: v3.norm(transformDirection(matrix, handle.anchor.direction)),
          }
    if (!anchor) return []
    return [
      {
        id,
        kind: 'arrow',
        ...anchor,
        length: value * scale,
        input: handle.input,
        inputKind: input.kind,
        scale,
      },
    ]
  })
}
