import { originFrame } from '../assembly/fromDocument'
import { snapFromMesh } from '../assembly/snaps'
import {
  activeFeatures,
  expandInstances,
  findFeature,
  multiplyMatrices,
  pathKey,
  pathMatrix,
} from '../doc/model'
import type { Matrix4, OkcDocument } from '../doc/types'
import type { BodyMesh, Instance } from '../kernel/types'
import { jointSnapPick } from '../ui/command/picks'
import type { SelectionPick } from '../ui/command/types'
import type { JointGlyph, ViewportEngine } from './engine'

export interface SnapHit {
  pick: SelectionPick
  world: Matrix4
}

export function worldOfPath(
  doc: OkcDocument,
  instances: readonly Instance[],
  path: string[],
): Matrix4 | null {
  const key = pathKey(path)
  const instance = instances.find((candidate) => pathKey(candidate.path) === key)
  return instance?.matrix ?? pathMatrix(doc, path)
}

export function snapAt(
  engine: ViewportEngine,
  doc: OkcDocument,
  instances: readonly Instance[],
  meshes: ReadonlyMap<string, BodyMesh>,
  clientX: number,
  clientY: number,
): SnapHit | null {
  const sub = engine.pickSub(clientX, clientY, { catalogue: true, vertices: false })
  if (!sub) return null
  const instance = instances.find((candidate) => candidate.id === sub.instanceId)
  const mesh = instance ? meshes.get(instance.meshKey) : undefined
  if (!instance || !mesh) return null
  const hit = engine.pick(clientX, clientY)
  const onInstance = hit?.instanceId === instance.id ? hit : null
  const near = sub.kind === 'vertex' ? sub.point : (onInstance?.localPoint ?? sub.point)
  const hash = sub.id.indexOf('#')
  const id = hash >= 0 ? Number(sub.id.slice(hash + 1)) : undefined
  const snap = snapFromMesh(mesh, sub.kind, sub.name, near, onInstance?.localNormal, id)
  if (!snap) return null
  const pick = jointSnapPick(doc, {
    occurrencePath: instance.path,
    snap: {
      ref: sub.name ? { bodyId: instance.bodyId, kind: sub.kind, name: sub.name } : null,
      keypoint: snap.keypoint,
    },
    frame: snap.frame,
  })
  return { pick, world: multiplyMatrices(instance.matrix, snap.frame) }
}

export function glyphFeatureId(id: string): string {
  return id.startsWith('origin:') ? id.slice(7, id.lastIndexOf('@')) : id
}

export function originSnapAt(
  doc: OkcDocument,
  instances: readonly Instance[],
  glyphId: string | null,
): SnapHit | null {
  if (!glyphId?.startsWith('origin:')) return null
  const origin = findFeature(doc, glyphFeatureId(glyphId))
  if (origin?.kind !== 'jointOrigin') return null
  const key = glyphId.slice(glyphId.lastIndexOf('@') + 1)
  const node = expandInstances(doc).find((candidate) => pathKey(candidate.path) === key)
  if (!node) return null
  const world = worldOfPath(doc, instances, node.path)
  if (!world) return null
  const frame = originFrame(origin)
  const pick = jointSnapPick(doc, {
    occurrencePath: node.path,
    snap: { ref: null, keypoint: 'origin', originId: origin.id },
    frame,
  })
  return { pick, world: multiplyMatrices(world, frame) }
}

export function jointGlyphs(
  doc: OkcDocument,
  instances: readonly Instance[],
  options: {
    picks: readonly SelectionPick[]
    hover: SnapHit | null
    selectedId?: string
    hotId?: string | null
    skipId?: string
  },
): JointGlyph[] {
  const glyphs: JointGlyph[] = []
  const nodes = expandInstances(doc)
  for (const feature of activeFeatures(doc)) {
    if (feature.kind !== 'jointOrigin' || feature.id === options.skipId) continue
    const frame = originFrame(feature)
    for (const node of nodes) {
      if (node.componentId !== feature.componentId) continue
      const world = worldOfPath(doc, instances, node.path)
      if (!world) continue
      glyphs.push({
        id: `origin:${feature.id}@${pathKey(node.path)}`,
        frame: multiplyMatrices(world, frame),
        tone:
          feature.id === options.selectedId
            ? 'picked'
            : feature.id === options.hotId
              ? 'hover'
              : 'origin',
      })
    }
  }
  for (const feature of activeFeatures(doc)) {
    if (feature.kind !== 'joint' || feature.id === options.skipId) continue
    const world = worldOfPath(doc, instances, feature.two.occurrencePath)
    if (!world) continue
    glyphs.push({
      id: feature.id,
      frame: multiplyMatrices(world, feature.two.frame),
      tone:
        feature.id === options.selectedId
          ? 'picked'
          : feature.id === options.hotId
            ? 'hover'
            : 'placed',
    })
  }
  for (const pick of options.picks) {
    if (!pick.joint) continue
    const world = worldOfPath(doc, instances, pick.joint.occurrencePath)
    if (world) {
      glyphs.push({ id: pick.id, frame: multiplyMatrices(world, pick.joint.frame), tone: 'picked' })
    }
  }
  if (options.hover) {
    glyphs.push({ id: options.hover.pick.id, frame: options.hover.world, tone: 'hover' })
  }
  return glyphs
}
