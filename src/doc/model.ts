import type { Vec3 } from '../core/math'
import type {
  Body,
  BodyOperation,
  Component,
  ElementRef,
  Feature,
  Matrix4,
  Occurrence,
  OkcDocument,
  TimelineGroup,
} from './types'

export function markerIndex(doc: OkcDocument): number {
  if (doc.marker === null) return doc.timeline.length
  return Math.max(0, Math.min(doc.marker, doc.timeline.length))
}

export function isRolledBack(doc: OkcDocument, index: number): boolean {
  return index >= markerIndex(doc)
}

export function activeFeatures(doc: OkcDocument): Feature[] {
  return doc.timeline.slice(0, markerIndex(doc)).filter((feature) => !feature.suppressed)
}

export function findFeature(doc: OkcDocument, id: string): Feature | undefined {
  return doc.timeline.find((feature) => feature.id === id)
}

export function featureIndex(doc: OkcDocument, id: string): number {
  return doc.timeline.findIndex((feature) => feature.id === id)
}

export function findComponent(doc: OkcDocument, id: string): Component | undefined {
  return doc.components.find((component) => component.id === id)
}

export function findOccurrence(doc: OkcDocument, id: string): Occurrence | undefined {
  return doc.occurrences.find((occurrence) => occurrence.id === id)
}

export function childOccurrences(doc: OkcDocument, componentId: string): Occurrence[] {
  return doc.occurrences.filter((occurrence) => occurrence.parentComponentId === componentId)
}

export function findBody(
  doc: OkcDocument,
  bodyId: string,
): { component: Component; body: Body } | undefined {
  for (const component of doc.components) {
    const body = component.bodies.find((candidate) => candidate.id === bodyId)
    if (body) return { component, body }
  }
  return undefined
}

export function allBodies(doc: OkcDocument): Array<{ component: Component; body: Body }> {
  return doc.components.flatMap((component) =>
    component.bodies.map((body) => ({ component, body })),
  )
}

function operationOf(feature: Feature): BodyOperation | null {
  return 'result' in feature ? feature.result : null
}

export function featureCreatesBodies(feature: Feature): string[] {
  switch (feature.kind) {
    case 'meshInsert':
    case 'tessellate':
    case 'meshConvert':
      return [feature.bodyId]
    case 'meshPlaneCut':
      return feature.keep === 'both' ? [feature.newBodyId] : []
    case 'meshSeparate':
    case 'bodyPattern':
    case 'mirror':
    case 'unstitch':
      return feature.newBodyIds
    case 'patch':
    case 'surfaceOffset':
      return [feature.bodyId]
    case 'splitBody':
      return [feature.newBodyId]
    case 'fitCoupon':
      return [feature.pinBodyId, feature.holeBodyId]
    case 'screwLid':
      return [feature.capBodyId]
    case 'enclosure':
      return [feature.bodyId, feature.lidBodyId]
    case 'cableEntry':
      return feature.barBodyId ? [feature.barBodyId] : []
  }
  const operation = operationOf(feature)
  return operation?.kind === 'newBody' ? [operation.bodyId] : []
}

export function featureModifiesBodies(feature: Feature): string[] {
  switch (feature.kind) {
    case 'fillet':
    case 'chamfer':
    case 'shell':
    case 'hole':
    case 'vent':
    case 'portCutout':
    case 'lidSocket':
    case 'combine':
      return [feature.bodyId]
    case 'emboss':
      return [feature.face.bodyId]
    case 'cableEntry':
    case 'boardClips':
      return [feature.bodyId]
    case 'screwLid':
      return [feature.face.bodyId]
    case 'rib':
    case 'web':
      return [feature.bodyId]
    case 'snapFit':
    case 'fitPins':
    case 'lipGroove':
    case 'dovetail':
    case 'snapRing':
    case 'bayonet':
    case 'hinge':
      return feature.mateBodyId && feature.mateBodyId !== feature.bodyId
        ? [feature.bodyId, feature.mateBodyId]
        : [feature.bodyId]
    case 'move':
    case 'meshReverse':
    case 'scale':
    case 'reverseNormal':
      return feature.bodyIds
    case 'stitch':
      return feature.bodyIds.slice(0, 1)
    case 'splitBody':
    case 'unstitch':
    case 'offsetFace':
    case 'draft':
      return [feature.bodyId]
    case 'meshRepair':
    case 'meshReduce':
    case 'meshRemesh':
    case 'meshSmooth':
    case 'meshPlaneCut':
    case 'meshSeparate':
    case 'meshCombine':
      return [feature.bodyId]
    default: {
      const operation = operationOf(feature)
      if (!operation || operation.kind === 'newBody') return []
      return operation.kind === 'join' ? [operation.bodyId] : operation.bodyIds
    }
  }
}

export function featureReadsBodies(feature: Feature): string[] {
  const bodies: string[] = []
  if ('plane' in feature && feature.plane.kind === 'face') bodies.push(feature.plane.face.bodyId)
  if (feature.kind === 'constructionPlane') {
    for (const ref of [feature.base, feature.second]) {
      if (ref?.kind === 'face') bodies.push(ref.face.bodyId)
    }
  }
  if (feature.kind === 'joint') {
    for (const side of [feature.one, feature.two]) {
      if (side.snap.ref) bodies.push(side.snap.ref.bodyId)
    }
  }
  if (feature.kind === 'jointOrigin' && feature.snap.ref) bodies.push(feature.snap.ref.bodyId)
  if (feature.kind === 'tessellate' || feature.kind === 'meshConvert') {
    bodies.push(feature.sourceBodyId)
  }
  if (feature.kind === 'meshCombine') bodies.push(...feature.toolBodyIds)
  if (feature.kind === 'thicken' || feature.kind === 'surfaceOffset') {
    bodies.push(feature.sourceBodyId)
  }
  if (feature.kind === 'bodyPattern' || feature.kind === 'mirror') bodies.push(...feature.bodyIds)
  if (feature.kind === 'stitch') bodies.push(...feature.bodyIds.slice(1))
  if (feature.kind === 'combine') bodies.push(...feature.toolBodyIds)
  if (feature.kind === 'lid') bodies.push(feature.sourceBodyId)
  if (feature.kind === 'snapRing' || feature.kind === 'bayonet') bodies.push(feature.face.bodyId)
  return bodies
}

export function bodyCreator(doc: OkcDocument, bodyId: string): Feature | undefined {
  return doc.timeline.find((feature) => featureCreatesBodies(feature).includes(bodyId))
}

export function featureDependencies(doc: OkcDocument, feature: Feature): string[] {
  const dependencies = new Set<string>()
  if (feature.kind === 'extrude' || feature.kind === 'revolve') dependencies.add(feature.sketchId)
  if (feature.kind === 'loft')
    for (const section of feature.sections) dependencies.add(section.sketchId)
  if (feature.kind === 'sweep') {
    dependencies.add(feature.sketchId)
    dependencies.add(feature.pathSketchId)
  }
  if (feature.kind === 'pipe') dependencies.add(feature.pathSketchId)
  const planeRefs =
    feature.kind === 'constructionPlane'
      ? [feature.base, feature.second]
      : 'plane' in feature
        ? [feature.plane]
        : []
  for (const ref of planeRefs) {
    if (ref?.kind === 'construction') dependencies.add(ref.featureId)
  }
  if (feature.kind === 'patch' || feature.kind === 'emboss') dependencies.add(feature.sketchId)
  if (feature.kind === 'rib' || feature.kind === 'web') dependencies.add(feature.sketchId)
  if (feature.kind === 'lid') dependencies.add(feature.shellFeatureId)
  if (feature.kind === 'lidSocket') dependencies.add(feature.lidFeatureId)
  if (feature.kind === 'motionLink') {
    dependencies.add(feature.a.jointId)
    dependencies.add(feature.b.jointId)
  }
  if (feature.kind === 'joint') {
    for (const side of [feature.one, feature.two]) {
      if (side.snap.originId) dependencies.add(side.snap.originId)
    }
  }
  if (feature.kind === 'jointOrigin' && feature.snap.originId) {
    dependencies.add(feature.snap.originId)
  }
  for (const bodyId of [...featureModifiesBodies(feature), ...featureReadsBodies(feature)]) {
    const creator = bodyCreator(doc, bodyId)
    if (creator && creator.id !== feature.id) dependencies.add(creator.id)
  }
  return [...dependencies]
}

export function featureDependents(doc: OkcDocument, id: string): Feature[] {
  return doc.timeline.filter(
    (feature) => feature.id !== id && featureDependencies(doc, feature).includes(id),
  )
}

export function canMoveFeature(doc: OkcDocument, id: string, toIndex: number): boolean {
  const from = featureIndex(doc, id)
  if (from < 0 || toIndex < 0 || toIndex >= doc.timeline.length) return false
  const order = doc.timeline.map((feature) => feature.id)
  order.splice(from, 1)
  order.splice(toIndex, 0, id)
  const position = new Map(order.map((featureId, index) => [featureId, index]))
  return doc.timeline.every((feature) =>
    featureDependencies(doc, feature).every(
      (dependency) => (position.get(dependency) ?? -1) < (position.get(feature.id) ?? 0),
    ),
  )
}

export function identityMatrix(): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function translationMatrix([x, y, z]: Vec3): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

export function rotationMatrix(axis: 'x' | 'y' | 'z', degrees: number): Matrix4 {
  const radians = (degrees * Math.PI) / 180
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
  if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
  const out = identityMatrix()
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k]
      out[column * 4 + row] = sum
    }
  }
  return out
}

export function transformPoint(m: Matrix4, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

export function transformDirection(m: Matrix4, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ]
}

export function invertRigidMatrix(m: Matrix4): Matrix4 {
  const tx = m[12]
  const ty = m[13]
  const tz = m[14]
  return [
    m[0],
    m[4],
    m[8],
    0,
    m[1],
    m[5],
    m[9],
    0,
    m[2],
    m[6],
    m[10],
    0,
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    -(m[4] * tx + m[5] * ty + m[6] * tz),
    -(m[8] * tx + m[9] * ty + m[10] * tz),
    1,
  ]
}

export function placementMatrix(position: Vec3, turnDegrees: number, flipped: boolean): Matrix4 {
  const flip: Matrix4 = flipped
    ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
    : identityMatrix()
  return multiplyMatrices(
    translationMatrix(position),
    multiplyMatrices(rotationMatrix('z', turnDegrees), flip),
  )
}

export interface InstanceNode {
  path: string[]
  componentId: string
  matrix: Matrix4
  visible: boolean
  negative: boolean
}

export function expandInstances(doc: OkcDocument): InstanceNode[] {
  const nodes: InstanceNode[] = []
  const visit = (
    componentId: string,
    path: string[],
    matrix: Matrix4,
    visible: boolean,
    negative: boolean,
    lineage: Set<string>,
  ) => {
    nodes.push({ path, componentId, matrix, visible, negative })
    for (const occurrence of childOccurrences(doc, componentId)) {
      if (lineage.has(occurrence.componentId)) continue
      visit(
        occurrence.componentId,
        [...path, occurrence.id],
        multiplyMatrices(matrix, occurrence.transform),
        visible && occurrence.visible,
        negative || !!occurrence.negative,
        new Set(lineage).add(occurrence.componentId),
      )
    }
  }
  visit(doc.rootComponentId, [], identityMatrix(), true, false, new Set([doc.rootComponentId]))
  return nodes
}

export function pathMatrix(doc: OkcDocument, path: string[]): Matrix4 | null {
  let matrix = identityMatrix()
  let parent = doc.rootComponentId
  for (const id of path) {
    const occurrence = findOccurrence(doc, id)
    if (!occurrence || occurrence.parentComponentId !== parent) return null
    matrix = multiplyMatrices(matrix, occurrence.transform)
    parent = occurrence.componentId
  }
  return matrix
}

export function pathComponent(doc: OkcDocument, path: string[]): string | null {
  let parent = doc.rootComponentId
  for (const id of path) {
    const occurrence = findOccurrence(doc, id)
    if (!occurrence || occurrence.parentComponentId !== parent) return null
    parent = occurrence.componentId
  }
  return parent
}

export function pathKey(path: string[]): string {
  return path.length ? path.join('/') : 'root'
}

export function instanceId(path: string[], bodyId: string): string {
  return `${pathKey(path)}|${bodyId}`
}

export function parseInstanceId(id: string): { path: string[]; bodyId: string } {
  const bar = id.lastIndexOf('|')
  const key = id.slice(0, bar)
  return { path: key === 'root' ? [] : key.split('/'), bodyId: id.slice(bar + 1) }
}

export function componentContains(
  doc: OkcDocument,
  ancestorId: string,
  descendantId: string,
): boolean {
  const stack = [ancestorId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === descendantId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const occurrence of childOccurrences(doc, id)) stack.push(occurrence.componentId)
  }
  return false
}

export function wouldCreateCycle(
  doc: OkcDocument,
  parentComponentId: string,
  childComponentId: string,
): boolean {
  return componentContains(doc, childComponentId, parentComponentId)
}

export function isElementRef(value: unknown): value is ElementRef {
  const ref = value as ElementRef | null
  return (
    !!ref &&
    typeof ref.bodyId === 'string' &&
    typeof ref.name === 'string' &&
    (ref.kind === 'face' || ref.kind === 'edge' || ref.kind === 'vertex')
  )
}

export function remapElementName(name: string, ids: ReadonlyMap<string, string>): string {
  return name.replace(/[^:|&#]+/g, (token) => ids.get(token) ?? token)
}

export interface GroupSpan {
  group: TimelineGroup
  start: number
  end: number
}

export function timelineGroups(doc: OkcDocument): GroupSpan[] {
  const spans: GroupSpan[] = []
  for (const group of doc.groups) {
    const start = featureIndex(doc, group.firstId)
    const end = featureIndex(doc, group.lastId)
    if (start < 0 || end <= start) continue
    if (spans.some((span) => start <= span.end && end >= span.start)) continue
    spans.push({ group, start, end })
  }
  return spans.sort((a, b) => a.start - b.start)
}
