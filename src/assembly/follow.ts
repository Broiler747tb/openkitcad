import type { Vec3 } from '../core/math'
import { activeFeatures } from '../doc/model'
import { useStore } from '../doc/store'
import type { JointSnap, Matrix4, OkcDocument } from '../doc/types'
import type { BodyMesh, Instance } from '../kernel/types'
import { columnOf, dot, originOf } from './frames'
import { applyAssemblyResult, followOrigins, solveDocument } from './fromDocument'
import { frameAt, snapFromMesh } from './snaps'

function refreshed(
  snap: JointSnap,
  frame: Matrix4,
  instances: readonly Instance[],
  meshes: ReadonlyMap<string, BodyMesh>,
): Matrix4 | null {
  const ref = snap.ref
  if (!ref || ref.kind === 'vertex' || !ref.name) return null
  const instance = instances.find(
    (candidate) => candidate.bodyId === ref.bodyId && !candidate.previewTool,
  )
  const mesh = instance ? meshes.get(instance.meshKey) : undefined
  if (!mesh) return null
  const oldZ = columnOf(frame, 2)
  const found = snapFromMesh(mesh, ref.kind, ref.name, originOf(frame), oldZ)
  if (!found) return null
  const z = columnOf(found.frame, 2)
  const kept: Vec3 = dot(z, oldZ) < 0 ? [-z[0], -z[1], -z[2]] : z
  const next = frameAt(originOf(found.frame), kept, columnOf(frame, 0))
  return next.some((value, index) => Math.abs(value - frame[index]) > 1e-6) ? next : null
}

export function refreshJointFrames(
  doc: OkcDocument,
  instances: readonly Instance[],
  meshes: ReadonlyMap<string, BodyMesh>,
): boolean {
  let changed = false
  for (const feature of activeFeatures(doc)) {
    if (feature.kind === 'jointOrigin') {
      const next = refreshed(feature.snap, feature.base, instances, meshes)
      if (next) {
        feature.base = next
        changed = true
      }
    } else if (feature.kind === 'joint' && !feature.asBuilt) {
      for (const side of [feature.one, feature.two]) {
        if (side.snap.originId) continue
        const next = refreshed(side.snap, side.frame, instances, meshes)
        if (next) {
          side.frame = next
          changed = true
        }
      }
    }
  }
  return followOrigins(doc) || changed
}

export function followGeometry(): () => void {
  return useStore.subscribe((state, previous) => {
    if (state.meshes === previous.meshes || state.building) return
    if (state.transientBase || state.activeSketch) return
    if (!state.doc.timeline.some((f) => f.kind === 'joint' || f.kind === 'jointOrigin')) return
    const trial = structuredClone(state.doc)
    if (!refreshJointFrames(trial, state.instances, state.meshes)) return
    queueMicrotask(() => {
      const current = useStore.getState()
      if (current.doc !== state.doc) return
      current.commit(
        (doc) => {
          refreshJointFrames(doc, current.instances, current.meshes)
          applyAssemblyResult(doc, solveDocument(doc))
        },
        { transient: true },
      )
    })
  })
}
