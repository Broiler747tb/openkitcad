import type { Vec3 } from '../../../core/math'
import { findBody, multiplyMatrices, rotationMatrix, translationMatrix } from '../../../doc/model'
import { useStore } from '../../../doc/store'
import type {
  Feature,
  Matrix4,
  MeshCombineFeature,
  MeshConvertFeature,
  MeshInsertFeature,
  MeshPlaneCutFeature,
  MeshReduceFeature,
  MeshRemeshFeature,
  MeshRepairFeature,
  MeshReverseFeature,
  MeshSeparateFeature,
  MeshSmoothFeature,
  OkcDocument,
  PlaneRef,
  TessellateFeature,
} from '../../../doc/types'
import type { BodyMesh } from '../../../kernel/types'
import { MILLIMETRES_PER_UNIT, type MeshUnit } from '../../../mesh/types'
import { defineCommand, type LooseCommandValues, type SelectionPick } from '../types'
import { bodyIdsOf, planeOf } from './shared'

export interface PendingMesh {
  name: string
  dataId: string
  min: Vec3
  max: Vec3
  triangles: number
}

let pending: PendingMesh[] = []

export function setPendingMeshes(meshes: PendingMesh[]) {
  pending = meshes
}

export function pendingMeshes(): PendingMesh[] {
  return pending
}

export function bodyMeshOf(bodyId: string): BodyMesh | undefined {
  const state = useStore.getState()
  const instance = state.instances.find(
    (candidate) => candidate.bodyId === bodyId && !candidate.previewTool,
  )
  return instance ? state.meshes.get(instance.meshKey) : undefined
}

function kindProblem(
  picks: readonly SelectionPick[],
  input: string,
  want: 'mesh' | 'solid',
): Record<string, string> | null {
  for (const id of bodyIdsOf(picks)) {
    const kind = bodyMeshOf(id)?.kind
    if (!kind) continue
    if (want === 'mesh' && kind !== 'mesh') {
      return { [input]: 'Pick a mesh body. Tessellate turns a solid into a mesh.' }
    }
    if (want === 'solid' && kind === 'mesh') {
      return { [input]: 'That is already a mesh. Pick a solid body.' }
    }
  }
  return null
}

const MESH_BODY = {
  id: 'body',
  kind: 'selection',
  label: 'Mesh Body',
  filter: ['body'],
  min: 1,
  max: 1,
  prompt: 'Select a mesh body',
} as const

function nameBody(doc: OkcDocument, bodyId: string, base: string) {
  const found = findBody(doc, bodyId)
  if (!found) return
  const taken = new Set(
    doc.components.flatMap((component) =>
      component.bodies.filter((body) => body.id !== bodyId).map((body) => body.name),
    ),
  )
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
  found.body.name = name
}

function componentOf(doc: OkcDocument, bodyId: string, fallback: string): string {
  return findBody(doc, bodyId)?.component.id ?? fallback
}

const UNIT_OPTIONS = [
  { value: 'mm', label: 'Millimetre' },
  { value: 'cm', label: 'Centimetre' },
  { value: 'm', label: 'Metre' },
  { value: 'in', label: 'Inch' },
  { value: 'ft', label: 'Foot' },
  { value: 'um', label: 'Micrometre' },
] as const

export function insertTransform(
  mesh: Pick<PendingMesh, 'min' | 'max'>,
  options: { unit: MeshUnit; yUp: boolean; centre: boolean; ground: boolean },
): Matrix4 {
  const factor = MILLIMETRES_PER_UNIT[options.unit]
  const scaled: Matrix4 = [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1]
  const turned = options.yUp ? multiplyMatrices(rotationMatrix('x', 90), scaled) : scaled
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const x of [mesh.min[0], mesh.max[0]]) {
    for (const y of [mesh.min[1], mesh.max[1]]) {
      for (const z of [mesh.min[2], mesh.max[2]]) {
        const p = [
          turned[0] * x + turned[4] * y + turned[8] * z,
          turned[1] * x + turned[5] * y + turned[9] * z,
          turned[2] * x + turned[6] * y + turned[10] * z,
        ]
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k])
          hi[k] = Math.max(hi[k], p[k])
        }
      }
    }
  }
  const shift: Vec3 = [
    options.centre ? -(lo[0] + hi[0]) / 2 : 0,
    options.centre ? -(lo[1] + hi[1]) / 2 : 0,
    options.ground ? -lo[2] : 0,
  ]
  return multiplyMatrices(translationMatrix(shift), turned)
}

export const meshInsertCommand = defineCommand({
  id: 'meshInsert',
  label: 'Insert Mesh',
  hint: 'Places an STL, OBJ or 3MF mesh in the design as a mesh body.',
  icon: '▲',
  inputs: [
    {
      id: 'unit',
      kind: 'choice',
      label: 'Unit Type',
      hint: 'The unit the file was written in.',
      options: UNIT_OPTIONS,
      default: 'mm',
    },
    {
      id: 'yUp',
      kind: 'toggle',
      label: 'Y Is Up',
      hint: 'Stands up models saved with Y as the up axis.',
    },
    {
      id: 'centre',
      kind: 'toggle',
      label: 'Center',
      hint: 'Moves the mesh to the middle of the origin.',
      default: true,
    },
    {
      id: 'ground',
      kind: 'toggle',
      label: 'Place on Ground',
      hint: 'Sets the mesh down on the XY plane.',
      default: true,
    },
  ],
  validate(_values, context) {
    if (context.editing) return null
    return pending.length ? null : 'Choose a mesh file first.'
  },
  build(values, context) {
    const options = {
      unit: values.unit as MeshUnit,
      yUp: values.yUp,
      centre: values.centre,
      ground: values.ground,
    }
    const editing = context.editing?.kind === 'meshInsert' ? context.editing : null
    const sources = editing
      ? pending.filter((mesh) => mesh.dataId === editing.dataId).slice(0, 1)
      : pending
    return sources.map((mesh, index): MeshInsertFeature => ({
      id: editing?.id ?? context.id(`meshInsert${index}`),
      kind: 'meshInsert',
      name: editing?.name ?? `Insert ${mesh.name}`,
      componentId: editing?.componentId ?? context.componentId,
      bodyId: editing?.bodyId ?? context.id(`mesh${index}`),
      dataId: mesh.dataId,
      transform: insertTransform(mesh, options),
      unit: options.unit,
      yUp: options.yUp,
      centre: options.centre,
      ground: options.ground,
    }))
  },
  adjust(doc, features, context) {
    if (context.editing) return
    features.forEach((feature, index) => {
      if (feature.kind !== 'meshInsert') return
      const name = pending[index]?.name
      if (name) nameBody(doc, feature.bodyId, name)
    })
  },
})

export const tessellateCommand = defineCommand({
  id: 'tessellate',
  label: 'Tessellate',
  hint: 'Turns a solid body into a mesh body of triangles.',
  icon: '◬',
  inputs: [
    {
      id: 'body',
      kind: 'selection',
      label: 'Body',
      filter: ['body'],
      min: 1,
      max: 1,
      prompt: 'Select a solid body',
    },
    {
      id: 'refinement',
      kind: 'choice',
      label: 'Refinement',
      options: [
        { value: 'coarse', label: 'Coarse', hint: 'Few triangles, visibly faceted.' },
        { value: 'medium', label: 'Medium', hint: 'A good match for most prints.' },
        { value: 'high', label: 'High', hint: 'Many small triangles that follow curves closely.' },
      ],
      default: 'medium',
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'solid')
  },
  build(values, context) {
    const source = bodyIdsOf(values.body)[0]
    const editing = context.editing?.kind === 'tessellate' ? context.editing : null
    const feature: TessellateFeature = {
      id: editing?.id ?? context.id('tessellate'),
      kind: 'tessellate',
      name: editing?.name ?? 'Tessellate',
      componentId: componentOf(context.doc, source, context.componentId),
      sourceBodyId: source,
      bodyId: editing?.bodyId ?? context.id('mesh'),
      refinement: values.refinement,
    }
    return [feature]
  },
  adjust(doc, features, context) {
    if (context.editing) return
    for (const feature of features) {
      if (feature.kind !== 'tessellate') continue
      const source = findBody(doc, feature.sourceBodyId)
      if (source) source.body.visible = false
      if (source) nameBody(doc, feature.bodyId, `${source.body.name} Mesh`)
    }
  },
})

function editingOf<K extends Feature['kind']>(
  editing: Feature | undefined,
  kind: K,
): Extract<Feature, { kind: K }> | null {
  return editing?.kind === kind ? (editing as Extract<Feature, { kind: K }>) : null
}

export const meshRepairCommand = defineCommand({
  id: 'meshRepair',
  label: 'Repair',
  hint: 'Joins loose triangles, turns them all the same way and closes small holes.',
  icon: '✚',
  inputs: [
    MESH_BODY,
    {
      id: 'closeHoles',
      kind: 'toggle',
      label: 'Close Holes',
      hint: 'Fills openings in the surface so the mesh is watertight.',
      default: true,
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'mesh')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshRepair')
    const feature: MeshRepairFeature = {
      id: editing?.id ?? context.id('meshRepair'),
      kind: 'meshRepair',
      name: editing?.name ?? 'Repair',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      closeHoles: values.closeHoles,
    }
    return [feature]
  },
})

export const meshReduceCommand = defineCommand({
  id: 'meshReduce',
  label: 'Reduce',
  hint: 'Uses fewer, larger triangles while keeping the shape.',
  icon: '▼',
  inputs: [
    MESH_BODY,
    {
      id: 'method',
      kind: 'choice',
      label: 'Reduce Target',
      options: [
        { value: 'proportion', label: 'Proportion', hint: 'Keep a share of the triangles.' },
        { value: 'tolerance', label: 'Tolerance', hint: 'Remove what stays within a distance.' },
        { value: 'count', label: 'Face Count', hint: 'Stop at a number of triangles.' },
      ],
      default: 'proportion',
    },
    {
      id: 'proportion',
      kind: 'integer',
      label: 'Proportion %',
      default: 50,
      min: 1,
      max: 99,
      visible: (values) => values.method === 'proportion',
    },
    {
      id: 'tolerance',
      kind: 'length',
      label: 'Tolerance',
      default: 0.05,
      min: 0,
      exclusiveMin: true,
      visible: (values) => values.method === 'tolerance',
    },
    {
      id: 'count',
      kind: 'integer',
      label: 'Face Count',
      default: 1000,
      min: 4,
      visible: (values) => values.method === 'count',
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'mesh')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshReduce')
    const feature: MeshReduceFeature = {
      id: editing?.id ?? context.id('meshReduce'),
      kind: 'meshReduce',
      name: editing?.name ?? 'Reduce',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      method: values.method,
      proportion: values.proportion / 100,
      tolerance: values.tolerance,
      count: values.count,
    }
    return [feature]
  },
})

export function averageEdge(bodyId: string): number | null {
  const mesh = bodyMeshOf(bodyId)
  if (!mesh) return null
  const { vertices, triangles } = mesh.mesh
  let total = 0
  for (let i = 0; i < triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[i + k] * 3
      const b = triangles[i + ((k + 1) % 3)] * 3
      total += Math.hypot(
        vertices[b] - vertices[a],
        vertices[b + 1] - vertices[a + 1],
        vertices[b + 2] - vertices[a + 2],
      )
    }
  }
  return triangles.length ? Math.round((total / triangles.length) * 1000) / 1000 : null
}

export const meshRemeshCommand = defineCommand({
  id: 'meshRemesh',
  label: 'Remesh',
  hint: 'Rebuilds the mesh from evenly sized triangles that follow the same surface.',
  icon: '◇',
  inputs: [
    {
      ...MESH_BODY,
      fills: (pick) => {
        const out: Record<string, number> = {}
        const edge = averageEdge(pick.bodyId ?? pick.id)
        if (edge) out.edgeLength = edge
        return out
      },
    },
    {
      id: 'edgeLength',
      kind: 'length',
      label: 'Edge Length',
      hint: 'How long each triangle side should be.',
      default: 1,
      min: 0,
      exclusiveMin: true,
    },
    {
      id: 'preserveSharp',
      kind: 'toggle',
      label: 'Preserve Sharp Edges',
      hint: 'Keeps creases and corners where they are.',
      default: true,
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'mesh')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshRemesh')
    const feature: MeshRemeshFeature = {
      id: editing?.id ?? context.id('meshRemesh'),
      kind: 'meshRemesh',
      name: editing?.name ?? 'Remesh',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      edgeLength: values.edgeLength,
      preserveSharp: values.preserveSharp,
    }
    return [feature]
  },
})

export const meshSmoothCommand = defineCommand({
  id: 'meshSmooth',
  label: 'Smooth',
  hint: 'Evens out bumps and noise without shrinking the body.',
  icon: '≈',
  inputs: [
    MESH_BODY,
    {
      id: 'strength',
      kind: 'integer',
      label: 'Strength %',
      default: 50,
      min: 1,
      max: 90,
    },
    {
      id: 'iterations',
      kind: 'integer',
      label: 'Passes',
      hint: 'More passes smooth further.',
      default: 3,
      min: 1,
      max: 50,
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'mesh')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshSmooth')
    const feature: MeshSmoothFeature = {
      id: editing?.id ?? context.id('meshSmooth'),
      kind: 'meshSmooth',
      name: editing?.name ?? 'Smooth',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      strength: values.strength / 100,
      iterations: values.iterations,
    }
    return [feature]
  },
})

export const meshReverseCommand = defineCommand({
  id: 'meshReverse',
  label: 'Reverse Normal',
  hint: 'Turns meshes inside out, for files saved with their triangles facing in.',
  icon: '⇅',
  inputs: [
    {
      ...MESH_BODY,
      id: 'bodies',
      label: 'Mesh Bodies',
      max: undefined,
      prompt: 'Select mesh bodies',
    },
  ],
  validate(values) {
    return kindProblem(values.bodies, 'bodies', 'mesh')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = editingOf(context.editing, 'meshReverse')
    const feature: MeshReverseFeature = {
      id: editing?.id ?? context.id('meshReverse'),
      kind: 'meshReverse',
      name: editing?.name ?? 'Reverse Normal',
      componentId: componentOf(context.doc, bodyIds[0], context.componentId),
      bodyIds,
    }
    return [feature]
  },
})

const ORIGIN_PLANES = [
  { value: 'XY', label: 'XY' },
  { value: 'XZ', label: 'XZ' },
  { value: 'YZ', label: 'YZ' },
] as const

function planeCutPlane(values: LooseCommandValues): PlaneRef {
  const picks = values.plane as SelectionPick[]
  if (picks.length) {
    const ref = planeOf(picks)
    return { ...ref, offset: values.offset as number }
  }
  return {
    kind: 'named',
    name: values.origin as 'XY' | 'XZ' | 'YZ',
    offset: values.offset as number,
  }
}

export function middleAlong(bodyId: string, origin: string): number {
  const bounds = bodyMeshOf(bodyId)?.bounds
  if (!bounds) return 0
  const axis = origin === 'XY' ? 2 : origin === 'XZ' ? 1 : 0
  const middle = (bounds[axis] + bounds[axis + 3]) / 2
  return Math.round((origin === 'XZ' ? -middle : middle) * 1000) / 1000
}

export const meshPlaneCutCommand = defineCommand({
  id: 'meshPlaneCut',
  label: 'Plane Cut',
  hint: 'Cuts a mesh in two along a plane, and can close the cut so both parts stay solid.',
  icon: '⊟',
  inputs: [
    {
      ...MESH_BODY,
      fills: (pick) => ({ offset: middleAlong(pick.bodyId ?? pick.id, 'XY') }),
    },
    {
      id: 'plane',
      kind: 'selection',
      label: 'Cutting Plane',
      hint: 'A flat face to cut along. Leave it empty to use an origin plane.',
      filter: ['face', 'plane'],
      min: 0,
      max: 1,
      prompt: 'Origin plane',
    },
    {
      id: 'origin',
      kind: 'choice',
      label: 'Origin Plane',
      options: ORIGIN_PLANES,
      default: 'XY',
      display: 'buttons',
      visible: (values) => !(values.plane as SelectionPick[]).length,
    },
    { id: 'offset', kind: 'length', label: 'Offset', default: 0 },
    { id: 'flip', kind: 'toggle', label: 'Flip', hint: 'Swaps which side counts as the front.' },
    {
      id: 'keep',
      kind: 'choice',
      label: 'Cut Type',
      options: [
        { value: 'both', label: 'Split Body', hint: 'Keep both parts as separate bodies.' },
        { value: 'front', label: 'Trim', hint: 'Keep the part in front of the plane.' },
        { value: 'back', label: 'Trim Other Side', hint: 'Keep the part behind the plane.' },
      ],
      default: 'both',
    },
    {
      id: 'fill',
      kind: 'toggle',
      label: 'Fill',
      hint: 'Closes each cut with a flat cap.',
      default: true,
    },
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'mesh')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshPlaneCut')
    const feature: MeshPlaneCutFeature = {
      id: editing?.id ?? context.id('meshPlaneCut'),
      kind: 'meshPlaneCut',
      name: editing?.name ?? 'Plane Cut',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      plane: planeCutPlane(values as LooseCommandValues),
      flip: values.flip,
      fill: values.fill,
      keep: values.keep,
      newBodyId: editing?.newBodyId ?? context.id('meshCut'),
    }
    return [feature]
  },
  adjust(doc, features, context) {
    if (context.editing) return
    for (const feature of features) {
      if (feature.kind !== 'meshPlaneCut' || feature.keep !== 'both') continue
      const source = findBody(doc, feature.bodyId)
      if (source) nameBody(doc, feature.newBodyId, source.body.name)
    }
  },
})

export const meshSeparateCommand = defineCommand({
  id: 'meshSeparate',
  label: 'Separate',
  hint: 'Splits a mesh into one body for each loose piece.',
  icon: '⧉',
  inputs: [MESH_BODY],
  validate(values) {
    const problem = kindProblem(values.body, 'body', 'mesh')
    if (problem) return problem
    const bodyId = bodyIdsOf(values.body)[0]
    const pieces = bodyId ? bodyMeshOf(bodyId)?.pieces : undefined
    if (pieces !== undefined && pieces < 2) return { body: 'That mesh is already one piece.' }
    return null
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshSeparate')
    const pieces = Math.max(2, bodyMeshOf(bodyId)?.pieces ?? 2)
    const feature: MeshSeparateFeature = {
      id: editing?.id ?? context.id('meshSeparate'),
      kind: 'meshSeparate',
      name: editing?.name ?? 'Separate',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      newBodyIds: Array.from(
        { length: pieces - 1 },
        (_, index) => editing?.newBodyIds[index] ?? context.id(`piece${index}`),
      ),
    }
    return [feature]
  },
  adjust(doc, features, context) {
    if (context.editing) return
    for (const feature of features) {
      if (feature.kind !== 'meshSeparate') continue
      const source = findBody(doc, feature.bodyId)
      for (const id of feature.newBodyIds) if (source) nameBody(doc, id, source.body.name)
    }
  },
})

export const meshCombineCommand = defineCommand({
  id: 'meshCombine',
  label: 'Combine',
  hint: 'Merges mesh bodies into one mesh body.',
  icon: '⊞',
  inputs: [
    { ...MESH_BODY, id: 'target', label: 'Target Body' },
    {
      id: 'tools',
      kind: 'selection',
      label: 'Tool Bodies',
      filter: ['body'],
      min: 1,
      prompt: 'Select mesh bodies',
    },
  ],
  validate(values) {
    const target = bodyIdsOf(values.target)[0]
    if (target && bodyIdsOf(values.tools).includes(target)) {
      return { tools: 'The target cannot also be a tool.' }
    }
    return (
      kindProblem(values.target, 'target', 'mesh') ?? kindProblem(values.tools, 'tools', 'mesh')
    )
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.target)[0]
    const editing = editingOf(context.editing, 'meshCombine')
    const feature: MeshCombineFeature = {
      id: editing?.id ?? context.id('meshCombine'),
      kind: 'meshCombine',
      name: editing?.name ?? 'Combine Meshes',
      componentId: componentOf(context.doc, bodyId, context.componentId),
      bodyId,
      toolBodyIds: [...new Set(bodyIdsOf(values.tools))],
    }
    return [feature]
  },
  adjust(doc, features, context) {
    if (context.editing) return
    for (const feature of features) {
      if (feature.kind !== 'meshCombine') continue
      for (const id of feature.toolBodyIds) {
        const tool = findBody(doc, id)
        if (tool) tool.body.visible = false
      }
    }
  },
})

export const meshConvertCommand = defineCommand({
  id: 'meshConvert',
  label: 'Convert Mesh',
  hint: 'Turns a mesh body into a solid body made of flat faces.',
  icon: '⬢',
  inputs: [
    MESH_BODY,
    {
      id: 'method',
      kind: 'choice',
      label: 'Method',
      options: [
        { value: 'faceted', label: 'Faceted', hint: 'One flat face for every triangle.' },
        {
          value: 'prismatic',
          label: 'Prismatic',
          hint: 'Triangles that lie in one plane become a single face.',
        },
      ],
      default: 'prismatic',
    },
  ],
  validate(values) {
    const problem = kindProblem(values.body, 'body', 'mesh')
    if (problem) return problem
    const bodyId = bodyIdsOf(values.body)[0]
    const mesh = bodyId ? bodyMeshOf(bodyId) : undefined
    if (mesh && mesh.watertight === false) {
      return { body: 'The mesh has holes, so it would not make a solid. Repair it first.' }
    }
    return null
  },
  build(values, context) {
    const source = bodyIdsOf(values.body)[0]
    const editing = editingOf(context.editing, 'meshConvert')
    const feature: MeshConvertFeature = {
      id: editing?.id ?? context.id('meshConvert'),
      kind: 'meshConvert',
      name: editing?.name ?? 'Convert Mesh',
      componentId: componentOf(context.doc, source, context.componentId),
      sourceBodyId: source,
      bodyId: editing?.bodyId ?? context.id('body'),
      method: values.method,
    }
    return [feature]
  },
  adjust(doc, features, context) {
    if (context.editing) return
    for (const feature of features) {
      if (feature.kind !== 'meshConvert') continue
      const source = findBody(doc, feature.sourceBodyId)
      if (source) source.body.visible = false
      if (source) nameBody(doc, feature.bodyId, `${source.body.name} Solid`)
    }
  },
})
