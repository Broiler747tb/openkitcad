import type { Vec3 } from '../core/math'
import {
  identityMatrix,
  invertRigidMatrix,
  multiplyMatrices,
  pathKey,
  transformPoint,
} from '../doc/model'
import type { Matrix4 } from '../doc/types'
import {
  DEGREES,
  applyWorldDelta,
  axisIndex,
  columnOf,
  compose,
  cross,
  frameDistance,
  originOf,
  orthonormalized,
  wrapAngle,
} from './frames'
import { gram, rankOf, solveSymmetric, symmetricEigen } from './linear'
import {
  alignmentMatrix,
  decomposeMotion,
  displayFactor,
  dofMatrix,
  motionDofs,
  motionFactorOrder,
  motionMatrix,
  toDisplay,
  toInternal,
} from './motion'
import type {
  AsBuiltJoint,
  AsBuiltJointSpec,
  AssemblyDrag,
  AssemblyIssue,
  AssemblySolveInput,
  AssemblySolveOptions,
  AssemblySolveResult,
  DofLimits,
  DofSpec,
  Joint,
  JointAnchor,
  JointConflict,
  JointMotion,
  MeasuredJoint,
  OccurrenceFreedom,
} from './types'

export const DRAG_WEIGHT = 0.003

const ROTATE_STEP = 10 * DEGREES
const RANK_TOLERANCE = 1e-7
const NULL_TOLERANCE = 1e-12

interface Twist {
  w: Vec3
  v: Vec3
}

type EdgeKind = 'joint' | 'asBuiltJoint' | 'rigidGroup' | 'attach'

interface NodeState {
  key: string
  path: string[]
  input: Matrix4
  grounded: boolean
  virtual: boolean
  visited: boolean
  parentEdge: number
  forward: boolean
  rootSlot: number
}

interface EdgeState {
  kind: EdgeKind
  id: string
  one: number
  two: number
  frameOne: Matrix4
  frameOneInverse: Matrix4
  frameTwo: Matrix4
  frameTwoInverse: Matrix4
  align: Matrix4
  alignInverse: Matrix4
  motion: JointMotion
  dofs: DofSpec[]
  order: number[]
  q: number[]
  tree: boolean
}

interface Variable {
  edge: number
  spec: DofSpec
  min: number
  max: number
  rest: number | null
  initial: number
  locked: boolean
  linked: boolean
}

interface LinkState {
  id: string
  a: number
  b: number
  ratio: number
  offset: number
  jointIds: string[]
}

interface Problem {
  nodes: NodeState[]
  nodeIndex: Map<string, number>
  edges: EdgeState[]
  order: number[]
  loops: number[]
  variables: Variable[]
  links: LinkState[]
  rootNodes: number[]
  jointQ: Map<string, number[]>
  lengthScale: number
  issues: AssemblyIssue[]
}

interface State {
  q: Float64Array
  roots: Matrix4[]
}

interface Kinematics {
  worlds: Matrix4[]
  twists: Twist[][]
  closures: Matrix4[]
}

interface Columns {
  count: number
  ofQ: Int32Array
  ofRoot: Int32Array
  variableOf: Int32Array
}

interface Contribution {
  col: number
  twist: Twist
}

interface Rows {
  values: number[]
  gradients: Float64Array[]
}

const EDGE_PRIORITY: Record<EdgeKind, number> = {
  attach: 0,
  rigidGroup: 1,
  joint: 2,
  asBuiltJoint: 2,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function buildProblem(input: AssemblySolveInput): Problem {
  const issues: AssemblyIssue[] = []
  const nodes: NodeState[] = []
  const nodeIndex = new Map<string, number>()
  const addNode = (path: string[], transform: Matrix4, grounded: boolean, virtual: boolean) => {
    const key = pathKey(path)
    nodeIndex.set(key, nodes.length)
    nodes.push({
      key,
      path,
      input: orthonormalized(transform),
      grounded,
      virtual,
      visited: false,
      parentEdge: -1,
      forward: false,
      rootSlot: -1,
    })
  }
  for (const occurrence of input.occurrences) {
    const key = pathKey(occurrence.path)
    if (nodeIndex.has(key)) {
      issues.push({ id: key, message: `Occurrence ${key} is listed more than once.` })
      continue
    }
    addNode(
      occurrence.path,
      occurrence.transform,
      occurrence.grounded || occurrence.path.length === 0,
      false,
    )
  }
  if (!nodeIndex.has('root')) addNode([], identityMatrix(), true, true)

  const origins = new Map((input.origins ?? []).map((origin) => [origin.id, origin]))
  const resolve = (anchor: JointAnchor, owner: string): { node: number; frame: Matrix4 } | null => {
    let path: string[]
    let frame: Matrix4
    if (anchor.kind === 'origin') {
      const origin = origins.get(anchor.originId)
      if (!origin) {
        issues.push({ id: owner, message: `Joint origin ${anchor.originId} does not exist.` })
        return null
      }
      path = origin.occurrencePath
      frame = origin.frame
    } else {
      path = anchor.occurrencePath
      frame = anchor.frame
    }
    const node = nodeIndex.get(pathKey(path))
    if (node === undefined) {
      issues.push({ id: owner, message: `Occurrence ${pathKey(path)} is not in the assembly.` })
      return null
    }
    return { node, frame: orthonormalized(frame) }
  }

  const edges: EdgeState[] = []
  const variables: Variable[] = []
  const jointQ = new Map<string, number[]>()
  const rigid: JointMotion = { kind: 'rigid' }
  const addEdge = (
    kind: EdgeKind,
    id: string,
    one: number,
    two: number,
    frameOne: Matrix4,
    frameTwo: Matrix4,
    align: Matrix4,
    motion: JointMotion,
    values: number[],
    limits: DofLimits[],
    locked: boolean,
  ) => {
    const dofs = motionDofs(motion)
    const edgeIndex = edges.length
    const q = dofs.map((spec, dof) => {
      const limit = limits[dof] ?? {}
      const low = limit.min === undefined ? -Infinity : toInternal(spec, limit.min)
      const high = limit.max === undefined ? Infinity : toInternal(spec, limit.max)
      const min = Math.min(low, high)
      const max = Math.max(low, high)
      variables.push({
        edge: edgeIndex,
        spec,
        min,
        max,
        rest: limit.rest === undefined ? null : clamp(toInternal(spec, limit.rest), min, max),
        initial: clamp(toInternal(spec, values[dof] ?? 0), min, max),
        locked,
        linked: false,
      })
      return variables.length - 1
    })
    edges.push({
      kind,
      id,
      one,
      two,
      frameOne,
      frameOneInverse: invertRigidMatrix(frameOne),
      frameTwo,
      frameTwoInverse: invertRigidMatrix(frameTwo),
      align,
      alignInverse: invertRigidMatrix(align),
      motion,
      dofs,
      order: motionFactorOrder(motion),
      q,
      tree: false,
    })
    if (kind === 'joint' || kind === 'asBuiltJoint') jointQ.set(id, q)
  }
  const relativePlacement = (from: number, to: number) =>
    orthonormalized(multiplyMatrices(invertRigidMatrix(nodes[from].input), nodes[to].input))

  for (const group of input.rigidGroups ?? []) {
    if (group.suppressed) continue
    const members: number[] = []
    for (const path of group.members) {
      const node = nodeIndex.get(pathKey(path))
      if (node === undefined) {
        issues.push({
          id: group.id,
          message: `Occurrence ${pathKey(path)} is not in the assembly.`,
        })
      } else if (!members.includes(node)) {
        members.push(node)
      }
    }
    for (const member of members.slice(1)) {
      addEdge(
        'rigidGroup',
        group.id,
        member,
        members[0],
        identityMatrix(),
        relativePlacement(members[0], member),
        identityMatrix(),
        rigid,
        [],
        [],
        false,
      )
    }
  }

  for (const joint of input.joints ?? []) {
    if (joint.suppressed) continue
    if (jointQ.has(joint.id)) {
      issues.push({ id: joint.id, message: `Joint id ${joint.id} is used more than once.` })
      continue
    }
    const one = resolve(joint.one, joint.id)
    const two = resolve(joint.two, joint.id)
    if (!one || !two) continue
    if (one.node === two.node) {
      issues.push({ id: joint.id, message: `${joint.name} joins an occurrence to itself.` })
      continue
    }
    addEdge(
      'joint',
      joint.id,
      one.node,
      two.node,
      one.frame,
      two.frame,
      alignmentMatrix(joint),
      joint.motion,
      joint.values,
      joint.limits,
      !!joint.locked,
    )
  }

  for (const joint of input.asBuiltJoints ?? []) {
    if (joint.suppressed) continue
    if (jointQ.has(joint.id)) {
      issues.push({ id: joint.id, message: `Joint id ${joint.id} is used more than once.` })
      continue
    }
    const one = nodeIndex.get(pathKey(joint.one))
    const two = nodeIndex.get(pathKey(joint.two))
    if (one === undefined || two === undefined) {
      const missing = pathKey(one === undefined ? joint.one : joint.two)
      issues.push({ id: joint.id, message: `Occurrence ${missing} is not in the assembly.` })
      continue
    }
    if (one === two) {
      issues.push({ id: joint.id, message: `${joint.name} joins an occurrence to itself.` })
      continue
    }
    addEdge(
      'asBuiltJoint',
      joint.id,
      one,
      two,
      orthonormalized(joint.frame),
      orthonormalized(joint.twoFrame),
      identityMatrix(),
      joint.motion,
      joint.values,
      joint.limits,
      !!joint.locked,
    )
  }

  const involved = new Set<number>()
  for (const edge of edges) {
    involved.add(edge.one)
    involved.add(edge.two)
  }
  nodes.forEach((node, index) => {
    if (node.virtual || node.grounded || involved.has(index) || node.path.length < 2) return
    for (let length = node.path.length - 1; length >= 1; length--) {
      const parent = nodeIndex.get(pathKey(node.path.slice(0, length)))
      if (parent === undefined) continue
      addEdge(
        'attach',
        node.key,
        index,
        parent,
        identityMatrix(),
        relativePlacement(parent, index),
        identityMatrix(),
        rigid,
        [],
        [],
        false,
      )
      break
    }
  })

  const links: LinkState[] = []
  for (const link of input.motionLinks ?? []) {
    if (link.suppressed) continue
    const a = jointQ.get(link.a.jointId)?.[link.a.dof]
    const b = jointQ.get(link.b.jointId)?.[link.b.dof]
    if (a === undefined || b === undefined) {
      issues.push({
        id: link.id,
        message: `${link.name} names a joint motion that does not exist.`,
      })
      continue
    }
    variables[a].linked = true
    variables[b].linked = true
    links.push({
      id: link.id,
      a,
      b,
      ratio: link.ratio,
      offset: link.offset,
      jointIds: unique([link.a.jointId, link.b.jointId]),
    })
  }

  const adjacency: number[][] = nodes.map(() => [])
  edges
    .map((_, index) => index)
    .sort((a, b) => EDGE_PRIORITY[edges[a].kind] - EDGE_PRIORITY[edges[b].kind] || a - b)
    .forEach((index) => {
      adjacency[edges[index].one].push(index)
      adjacency[edges[index].two].push(index)
    })

  const order: number[] = []
  const rootNodes: number[] = []
  const queue: number[] = []
  const drain = () => {
    while (queue.length) {
      const current = queue.shift()!
      order.push(current)
      for (const edgeIndex of adjacency[current]) {
        const edge = edges[edgeIndex]
        const other = edge.one === current ? edge.two : edge.one
        if (nodes[other].visited) continue
        nodes[other].visited = true
        nodes[other].parentEdge = edgeIndex
        nodes[other].forward = other === edge.one
        edge.tree = true
        queue.push(other)
      }
    }
  }
  const seedFloating = (index: number) => {
    nodes[index].visited = true
    nodes[index].rootSlot = rootNodes.length
    rootNodes.push(index)
    queue.push(index)
    drain()
  }
  nodes.forEach((node, index) => {
    if (!node.grounded) return
    node.visited = true
    queue.push(index)
  })
  drain()
  for (const edge of edges) {
    if (edge.kind !== 'joint' && edge.kind !== 'asBuiltJoint') continue
    if (!nodes[edge.one].visited && !nodes[edge.two].visited) seedFloating(edge.two)
  }
  nodes.forEach((node, index) => {
    if (!node.visited) seedFloating(index)
  })
  const loops = edges.map((_, index) => index).filter((index) => !edges[index].tree)

  const low: Vec3 = [Infinity, Infinity, Infinity]
  const high: Vec3 = [-Infinity, -Infinity, -Infinity]
  const include = (point: Vec3) => {
    for (let c = 0; c < 3; c++) {
      low[c] = Math.min(low[c], point[c])
      high[c] = Math.max(high[c], point[c])
    }
  }
  for (const node of nodes) if (!node.virtual) include(originOf(node.input))
  for (const edge of edges) {
    include(transformPoint(nodes[edge.one].input, originOf(edge.frameOne)))
    include(transformPoint(nodes[edge.two].input, originOf(edge.frameTwo)))
  }
  const diagonal = Number.isFinite(low[0])
    ? Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2])
    : 0
  return {
    nodes,
    nodeIndex,
    edges,
    order,
    loops,
    variables,
    links,
    rootNodes,
    jointQ,
    lengthScale: Math.max(1, diagonal),
    issues,
  }
}

function initialState(problem: Problem): State {
  return {
    q: Float64Array.from(problem.variables.map((variable) => variable.initial)),
    roots: problem.rootNodes.map((index) => problem.nodes[index].input),
  }
}

function twistOf(frame: Matrix4, spec: DofSpec, sign: number): Twist {
  const column = columnOf(frame, axisIndex(spec.axis))
  const direction: Vec3 = [column[0] * sign, column[1] * sign, column[2] * sign]
  if (spec.kind === 'slide') return { w: [0, 0, 0], v: direction }
  return { w: direction, v: cross(originOf(frame), direction) }
}

function kinematics(problem: Problem, state: State): Kinematics {
  const { nodes, edges } = problem
  const worlds: Matrix4[] = new Array(nodes.length)
  const twists: Twist[][] = edges.map((edge) => new Array<Twist>(edge.dofs.length))
  const closures: Matrix4[] = new Array(edges.length)
  const forwardChain = (edgeIndex: number) => {
    const edge = edges[edgeIndex]
    let m = multiplyMatrices(worlds[edge.two], edge.frameTwo)
    for (const factor of edge.order) {
      twists[edgeIndex][factor] = twistOf(m, edge.dofs[factor], 1)
      m = multiplyMatrices(m, dofMatrix(edge.dofs[factor], state.q[edge.q[factor]]))
    }
    return multiplyMatrices(m, edge.align)
  }
  for (const index of problem.order) {
    const node = nodes[index]
    if (node.parentEdge < 0) {
      worlds[index] = node.rootSlot >= 0 ? state.roots[node.rootSlot] : node.input
      continue
    }
    const edgeIndex = node.parentEdge
    const edge = edges[edgeIndex]
    if (node.forward) {
      worlds[index] = multiplyMatrices(forwardChain(edgeIndex), edge.frameOneInverse)
    } else {
      let m = compose(worlds[edge.one], edge.frameOne, edge.alignInverse)
      for (let k = edge.order.length - 1; k >= 0; k--) {
        const factor = edge.order[k]
        twists[edgeIndex][factor] = twistOf(m, edge.dofs[factor], -1)
        m = multiplyMatrices(m, dofMatrix(edge.dofs[factor], -state.q[edge.q[factor]]))
      }
      worlds[index] = multiplyMatrices(m, edge.frameTwoInverse)
    }
  }
  for (const edgeIndex of problem.loops) closures[edgeIndex] = forwardChain(edgeIndex)
  return { worlds, twists, closures }
}

function columnsFor(problem: Problem, isFree: (index: number) => boolean): Columns {
  const ofQ = new Int32Array(problem.variables.length).fill(-1)
  const variableOf: number[] = []
  for (let index = 0; index < problem.variables.length; index++) {
    if (!isFree(index)) continue
    ofQ[index] = variableOf.length
    variableOf.push(index)
  }
  const ofRoot = new Int32Array(problem.rootNodes.length)
  let count = variableOf.length
  for (let slot = 0; slot < problem.rootNodes.length; slot++) {
    ofRoot[slot] = count
    for (let k = 0; k < 6; k++) variableOf.push(-1)
    count += 6
  }
  return { count, ofQ, ofRoot, variableOf: Int32Array.from(variableOf) }
}

function contributions(
  problem: Problem,
  kin: Kinematics,
  columns: Columns,
  node: number,
): Contribution[] {
  const list: Contribution[] = []
  let current = node
  while (problem.nodes[current].parentEdge >= 0) {
    const edgeIndex = problem.nodes[current].parentEdge
    const edge = problem.edges[edgeIndex]
    edge.q.forEach((qi, dof) => {
      const col = columns.ofQ[qi]
      if (col >= 0) list.push({ col, twist: kin.twists[edgeIndex][dof] })
    })
    current = problem.nodes[current].forward ? edge.two : edge.one
  }
  const slot = problem.nodes[current].rootSlot
  if (slot >= 0) {
    const base = columns.ofRoot[slot]
    const t = originOf(kin.worlds[current])
    for (let k = 0; k < 3; k++) {
      const e: Vec3 = [0, 0, 0]
      e[k] = 1
      list.push({ col: base + k, twist: { w: [0, 0, 0], v: e } })
      list.push({ col: base + 3 + k, twist: { w: e, v: cross(t, e) } })
    }
  }
  return list
}

function addPoseRows(
  rows: Rows,
  n: number,
  a: Matrix4,
  fromA: Contribution[],
  b: Matrix4,
  fromB: Contribution[],
  weight: number,
  scale: number,
) {
  const translation = [0, 1, 2].map(() => new Float64Array(n))
  const rotation = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new Float64Array(n))
  const sides: Array<[Matrix4, Contribution[], number]> = [
    [a, fromA, weight],
    [b, fromB, -weight],
  ]
  for (const [m, list, signedWeight] of sides) {
    const t = originOf(m)
    const axes = [columnOf(m, 0), columnOf(m, 1), columnOf(m, 2)]
    for (const { col, twist } of list) {
      const moved = cross(twist.w, t)
      for (let c = 0; c < 3; c++) translation[c][col] += signedWeight * (twist.v[c] + moved[c])
      for (let i = 0; i < 3; i++) {
        const turned = cross(twist.w, axes[i])
        for (let c = 0; c < 3; c++) rotation[i * 3 + c][col] += signedWeight * scale * turned[c]
      }
    }
  }
  for (let c = 0; c < 3; c++) {
    rows.values.push(weight * (a[12 + c] - b[12 + c]))
    rows.gradients.push(translation[c])
  }
  for (let i = 0; i < 3; i++) {
    for (let c = 0; c < 3; c++) {
      rows.values.push(weight * scale * (a[i * 4 + c] - b[i * 4 + c]))
      rows.gradients.push(rotation[i * 3 + c])
    }
  }
}

function addPointRows(
  rows: Rows,
  n: number,
  world: Matrix4,
  list: Contribution[],
  point: Vec3,
  target: Vec3,
  weight: number,
) {
  const p = transformPoint(world, point)
  const gradients = [0, 1, 2].map(() => new Float64Array(n))
  for (const { col, twist } of list) {
    const moved = cross(twist.w, p)
    for (let c = 0; c < 3; c++) gradients[c][col] += weight * (twist.v[c] + moved[c])
  }
  for (let c = 0; c < 3; c++) {
    rows.values.push(weight * (p[c] - target[c]))
    rows.gradients.push(gradients[c])
  }
}

function residuals(
  problem: Problem,
  kin: Kinematics,
  state: State,
  columns: Columns,
  drag: AssemblyDrag | undefined,
): Rows {
  const rows: Rows = { values: [], gradients: [] }
  const n = columns.count
  const scale = problem.lengthScale
  for (const edgeIndex of problem.loops) {
    const edge = problem.edges[edgeIndex]
    const fromB = contributions(problem, kin, columns, edge.two)
    edge.q.forEach((qi, dof) => {
      const col = columns.ofQ[qi]
      if (col >= 0) fromB.push({ col, twist: kin.twists[edgeIndex][dof] })
    })
    addPoseRows(
      rows,
      n,
      multiplyMatrices(kin.worlds[edge.one], edge.frameOne),
      contributions(problem, kin, columns, edge.one),
      kin.closures[edgeIndex],
      fromB,
      1,
      scale,
    )
  }
  for (const link of problem.links) {
    const specA = problem.variables[link.a].spec
    const specB = problem.variables[link.b].spec
    const target = toInternal(specB, link.ratio * toDisplay(specA, state.q[link.a]) + link.offset)
    const weight = specB.kind === 'rotate' ? scale : 1
    const gradient = new Float64Array(n)
    const colA = columns.ofQ[link.a]
    const colB = columns.ofQ[link.b]
    if (colB >= 0) gradient[colB] += weight
    if (colA >= 0) {
      gradient[colA] -=
        weight * (specB.kind === 'rotate' ? DEGREES : 1) * link.ratio * displayFactor(specA)
    }
    rows.values.push(weight * (state.q[link.b] - target))
    rows.gradients.push(gradient)
  }
  if (drag) {
    const node = problem.nodeIndex.get(pathKey(drag.path))
    if (node !== undefined) {
      const list = contributions(problem, kin, columns, node)
      if (drag.kind === 'pose') {
        addPoseRows(rows, n, kin.worlds[node], list, drag.target, [], DRAG_WEIGHT, scale)
      } else {
        addPointRows(rows, n, kin.worlds[node], list, drag.point, drag.target, DRAG_WEIGHT)
      }
    }
  }
  return rows
}

function sumSquares(values: number[]): number {
  let sum = 0
  for (const value of values) sum += value * value
  return sum
}

function relax(
  problem: Problem,
  state: State,
  fixed: Map<number, number>,
  drag: AssemblyDrag | undefined,
  maxIterations: number,
): number {
  for (const [index, value] of fixed) state.q[index] = value
  const columns = columnsFor(
    problem,
    (index) => !problem.variables[index].locked && !fixed.has(index),
  )
  const n = columns.count
  let kin = kinematics(problem, state)
  let rows = residuals(problem, kin, state, columns, drag)
  if (!rows.values.length || n === 0) return 0
  let cost = sumSquares(rows.values)
  let lambda = 1e-3
  let iterations = 0
  for (; iterations < maxIterations; iterations++) {
    if (cost < 1e-28) break
    const h = gram(rows.gradients, n)
    const g = new Float64Array(n)
    let gradientSize = 0
    rows.gradients.forEach((gradient, r) => {
      const value = rows.values[r]
      for (let i = 0; i < n; i++) g[i] += gradient[i] * value
    })
    for (let i = 0; i < n; i++) gradientSize = Math.max(gradientSize, Math.abs(g[i]))
    if (gradientSize < 1e-30) break
    let accepted = false
    let stepSize = 0
    while (!accepted) {
      const blocked = new Uint8Array(n)
      let step: Float64Array | null = null
      for (let pass = 0; pass < 4; pass++) {
        const a = new Float64Array(n * n)
        const rhs = new Float64Array(n)
        for (let i = 0; i < n; i++) {
          if (blocked[i]) {
            a[i * n + i] = 1
            continue
          }
          for (let j = 0; j < n; j++) if (!blocked[j]) a[i * n + j] = h[i * n + j]
          a[i * n + i] += lambda * Math.max(h[i * n + i], 1e-9) + 1e-18
          rhs[i] = -g[i]
        }
        step = solveSymmetric(a, rhs, n)
        if (!step) break
        let changed = false
        for (let i = 0; i < n; i++) {
          const index = columns.variableOf[i]
          if (index < 0 || blocked[i]) continue
          const variable = problem.variables[index]
          const value = state.q[index]
          if ((value <= variable.min && step[i] < 0) || (value >= variable.max && step[i] > 0)) {
            blocked[i] = 1
            changed = true
          }
        }
        if (!changed) break
      }
      if (!step) {
        lambda *= 10
        if (lambda > 1e12) return iterations
        continue
      }
      const trial: State = { q: new Float64Array(state.q), roots: state.roots.slice() }
      stepSize = 0
      for (let i = 0; i < n; i++) {
        const index = columns.variableOf[i]
        if (index < 0 || blocked[i]) continue
        const variable = problem.variables[index]
        trial.q[index] = clamp(state.q[index] + step[i], variable.min, variable.max)
        stepSize = Math.max(stepSize, Math.abs(trial.q[index] - state.q[index]))
      }
      for (let slot = 0; slot < problem.rootNodes.length; slot++) {
        const base = columns.ofRoot[slot]
        for (let k = 0; k < 6; k++) stepSize = Math.max(stepSize, Math.abs(step[base + k]))
        trial.roots[slot] = applyWorldDelta(state.roots[slot], step, base)
      }
      const trialKin = kinematics(problem, trial)
      const trialRows = residuals(problem, trialKin, trial, columns, drag)
      let change = 0
      for (let r = 0; r < rows.values.length; r++) {
        const before = rows.values[r]
        const after = trialRows.values[r]
        change += (after - before) * (after + before)
      }
      if (change < 0) {
        state.q = trial.q
        state.roots = trial.roots
        kin = trialKin
        rows = trialRows
        cost = sumSquares(trialRows.values)
        lambda = Math.max(lambda / 3, 1e-12)
        accepted = true
      } else {
        if (stepSize < 1e-12) return iterations
        lambda *= 4
        if (lambda > 1e12) return iterations
      }
    }
    if (stepSize < 1e-13) break
  }
  return iterations
}

function cycleEdges(problem: Problem, edgeIndex: number): number[] {
  const up = (start: number) => {
    const list: number[] = []
    let current = start
    while (problem.nodes[current].parentEdge >= 0) {
      const parent = problem.nodes[current].parentEdge
      list.push(parent)
      const edge = problem.edges[parent]
      current = problem.nodes[current].forward ? edge.two : edge.one
    }
    return list
  }
  const edge = problem.edges[edgeIndex]
  const a = up(edge.one)
  const b = up(edge.two)
  while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) {
    a.pop()
    b.pop()
  }
  return [edgeIndex, ...a, ...b]
}

function findConflicts(
  problem: Problem,
  kin: Kinematics,
  state: State,
  dragging: boolean,
): JointConflict[] {
  const translationTolerance = (dragging ? 1e-3 : 1e-6) + 1e-9 * problem.lengthScale
  const angleTolerance = dragging ? 1e-5 : 1e-8
  const conflicts: JointConflict[] = []
  for (const edgeIndex of problem.loops) {
    const edge = problem.edges[edgeIndex]
    const distance = frameDistance(
      multiplyMatrices(kin.worlds[edge.one], edge.frameOne),
      kin.closures[edgeIndex],
    )
    if (distance.translation <= translationTolerance && distance.angle <= angleTolerance) continue
    const cycle = cycleEdges(problem, edgeIndex).map((index) => problem.edges[index])
    conflicts.push({
      source: edge.kind === 'attach' ? 'rigidGroup' : edge.kind,
      id: edge.id,
      jointIds: unique(
        cycle
          .filter((item) => item.kind === 'joint' || item.kind === 'asBuiltJoint')
          .map((item) => item.id),
      ),
      rigidGroupIds: unique(
        cycle.filter((item) => item.kind === 'rigidGroup').map((item) => item.id),
      ),
      translationError: distance.translation,
      angleError: distance.angle,
    })
  }
  for (const link of problem.links) {
    const specA = problem.variables[link.a].spec
    const specB = problem.variables[link.b].spec
    const error = Math.abs(
      toDisplay(specB, state.q[link.b]) -
        (link.ratio * toDisplay(specA, state.q[link.a]) + link.offset),
    )
    if (error <= (dragging ? 1e-3 : 1e-6)) continue
    conflicts.push({
      source: 'motionLink',
      id: link.id,
      jointIds: link.jointIds,
      rigidGroupIds: [],
      translationError: specB.kind === 'slide' ? error : 0,
      angleError: specB.kind === 'rotate' ? error * DEGREES : 0,
    })
  }
  return conflicts
}

function analyseFreedom(
  problem: Problem,
  kin: Kinematics,
  state: State,
): { freedom: Record<string, OccurrenceFreedom>; mechanismDof: number } {
  const columns = columnsFor(problem, (index) => !problem.variables[index].locked)
  const n = columns.count
  const rows = residuals(problem, kin, state, columns, undefined)
  const basis: Float64Array[] = []
  if (!rows.values.length) {
    for (let i = 0; i < n; i++) {
      const vector = new Float64Array(n)
      vector[i] = 1
      basis.push(vector)
    }
  } else if (n > 0) {
    const { values, vectors } = symmetricEigen(gram(rows.gradients, n), n)
    const largest = Math.max(0, ...values)
    for (let i = 0; i < n; i++) {
      if (values[i] > NULL_TOLERANCE * largest) continue
      const vector = new Float64Array(n)
      for (let k = 0; k < n; k++) vector[k] = vectors[k * n + i]
      basis.push(vector)
    }
  }
  const scale = problem.lengthScale
  const threshold = RANK_TOLERANCE * scale
  const freedom: Record<string, OccurrenceFreedom> = {}
  problem.nodes.forEach((node, index) => {
    if (node.virtual) return
    const list = contributions(problem, kin, columns, index)
    if (!list.length || !basis.length) {
      freedom[node.key] = { dof: 0, rotations: 0, translations: 0 }
      return
    }
    const t = originOf(kin.worlds[index])
    const angular = [0, 1, 2].map(() => new Float64Array(basis.length))
    const linear = [0, 1, 2].map(() => new Float64Array(basis.length))
    basis.forEach((vector, k) => {
      for (const { col, twist } of list) {
        const coefficient = vector[col]
        if (coefficient === 0) continue
        const moved = cross(twist.w, t)
        for (let c = 0; c < 3; c++) {
          angular[c][k] += scale * twist.w[c] * coefficient
          linear[c][k] += (twist.v[c] + moved[c]) * coefficient
        }
      }
    })
    const dof = rankOf([...angular, ...linear], basis.length, threshold)
    const rotations = rankOf(angular, basis.length, threshold)
    freedom[node.key] = { dof, rotations, translations: dof - rotations }
  })
  return { freedom, mechanismDof: basis.length }
}

export function solveAssembly(
  input: AssemblySolveInput,
  options: AssemblySolveOptions = {},
): AssemblySolveResult {
  const problem = buildProblem(input)
  const state = initialState(problem)
  const issues = problem.issues
  const maxIterations = options.maxIterations ?? 100
  const targets = new Map<number, number>()
  if (options.applyRest) {
    problem.variables.forEach((variable, index) => {
      if (variable.rest !== null && !variable.locked) targets.set(index, variable.rest)
    })
  }
  for (const drive of options.drive ?? []) {
    const dof = drive.dof ?? 0
    const index = problem.jointQ.get(drive.jointId)?.[dof]
    if (index === undefined) {
      issues.push({
        id: drive.jointId,
        message: `Joint ${drive.jointId} has no motion number ${dof} to drive.`,
      })
      continue
    }
    const variable = problem.variables[index]
    if (variable.locked) {
      issues.push({ id: drive.jointId, message: `Joint ${drive.jointId} is locked.` })
      continue
    }
    targets.set(index, clamp(toInternal(variable.spec, drive.value), variable.min, variable.max))
  }
  const start = new Map([...targets.keys()].map((index) => [index, state.q[index]]))
  let steps = 1
  if (problem.loops.length || problem.links.length) {
    for (const [index, target] of targets) {
      const variable = problem.variables[index]
      const limit = variable.spec.kind === 'rotate' ? ROTATE_STEP : problem.lengthScale / 20
      steps = Math.max(steps, Math.ceil(Math.abs(target - start.get(index)!) / limit))
    }
    steps = Math.min(steps, 720)
  }
  let iterations = 0
  for (let step = 1; step <= steps; step++) {
    const fixed = new Map<number, number>()
    for (const [index, target] of targets) {
      const from = start.get(index)!
      fixed.set(index, from + ((target - from) * step) / steps)
    }
    iterations += relax(
      problem,
      state,
      fixed,
      step === steps ? options.drag : undefined,
      maxIterations,
    )
  }
  problem.variables.forEach((variable, index) => {
    if (variable.spec.kind !== 'rotate' || variable.linked) return
    if (Number.isFinite(variable.min) || Number.isFinite(variable.max)) return
    state.q[index] = wrapAngle(state.q[index])
  })

  const kin = kinematics(problem, state)
  const conflicts = findConflicts(problem, kin, state, !!options.drag)
  const { freedom, mechanismDof } = analyseFreedom(problem, kin, state)
  const transforms: Record<string, Matrix4> = {}
  const moved: string[] = []
  problem.nodes.forEach((node, index) => {
    if (node.virtual) return
    transforms[node.key] = kin.worlds[index]
    const distance = frameDistance(node.input, kin.worlds[index])
    if (distance.translation > 1e-9 || distance.angle > 1e-12) moved.push(node.key)
  })
  const jointValues: Record<string, number[]> = {}
  for (const edge of problem.edges) {
    if (edge.kind !== 'joint' && edge.kind !== 'asBuiltJoint') continue
    jointValues[edge.id] = edge.q.map((index, dof) => toDisplay(edge.dofs[dof], state.q[index]))
  }
  return {
    transforms,
    moved,
    jointValues,
    freedom,
    mechanismDof,
    conflicts,
    conflictingJoints: unique(conflicts.flatMap((conflict) => conflict.jointIds)),
    converged: conflicts.length === 0,
    iterations,
    issues,
  }
}

export function measureJointValues(input: AssemblySolveInput): Record<string, MeasuredJoint> {
  const problem = buildProblem(input)
  const measured: Record<string, MeasuredJoint> = {}
  for (const edge of problem.edges) {
    if (edge.kind !== 'joint' && edge.kind !== 'asBuiltJoint') continue
    const one = multiplyMatrices(problem.nodes[edge.one].input, edge.frameOne)
    const two = multiplyMatrices(problem.nodes[edge.two].input, edge.frameTwo)
    const relative = compose(invertRigidMatrix(two), one, edge.alignInverse)
    const internal = decomposeMotion(edge.motion, relative)
    const distance = frameDistance(motionMatrix(edge.motion, internal), relative)
    measured[edge.id] = {
      values: internal.map((value, dof) => toDisplay(edge.dofs[dof], value)),
      translationError: distance.translation,
      angleError: distance.angle,
    }
  }
  return measured
}

export function withJointValues(
  input: AssemblySolveInput,
  values: Record<string, number[]>,
): AssemblySolveInput {
  return {
    ...input,
    joints: input.joints?.map((joint): Joint =>
      values[joint.id] ? { ...joint, values: [...values[joint.id]] } : joint,
    ),
    asBuiltJoints: input.asBuiltJoints?.map((joint): AsBuiltJoint =>
      values[joint.id] ? { ...joint, values: [...values[joint.id]] } : joint,
    ),
  }
}

export function withMeasuredValues(input: AssemblySolveInput): AssemblySolveInput {
  const measured = measureJointValues(input)
  return withJointValues(
    input,
    Object.fromEntries(Object.entries(measured).map(([id, joint]) => [id, joint.values])),
  )
}

export function applySolveResult(
  input: AssemblySolveInput,
  result: AssemblySolveResult,
): AssemblySolveInput {
  return {
    ...withJointValues(input, result.jointValues),
    occurrences: input.occurrences.map((occurrence) => ({
      ...occurrence,
      transform: result.transforms[pathKey(occurrence.path)] ?? occurrence.transform,
    })),
  }
}

export function releaseDrag(
  input: AssemblySolveInput,
  dragged: AssemblySolveResult,
  options: Omit<AssemblySolveOptions, 'drag'> = {},
): AssemblySolveResult {
  return solveAssembly(applySolveResult(input, dragged), { applyRest: true, ...options })
}

export function createAsBuiltJoint(
  input: AssemblySolveInput,
  spec: AsBuiltJointSpec,
): AsBuiltJoint | null {
  const worldOf = (path: string[]) => {
    if (!path.length) return identityMatrix()
    const key = pathKey(path)
    const occurrence = input.occurrences.find((item) => pathKey(item.path) === key)
    return occurrence ? orthonormalized(occurrence.transform) : null
  }
  const one = worldOf(spec.one)
  const two = worldOf(spec.two)
  if (!one || !two) return null
  const frame = orthonormalized(spec.worldFrame)
  return {
    id: spec.id,
    name: spec.name,
    one: spec.one,
    two: spec.two,
    frame: multiplyMatrices(invertRigidMatrix(one), frame),
    twoFrame: multiplyMatrices(invertRigidMatrix(two), frame),
    snap: spec.snap ?? null,
    motion: spec.motion,
    values: motionDofs(spec.motion).map(() => 0),
    limits: spec.limits ?? [],
  }
}

export function jointDofs(joint: { motion: JointMotion }): DofSpec[] {
  return motionDofs(joint.motion)
}
