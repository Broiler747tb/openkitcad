import { create } from 'zustand'
import { applyAssemblyResult, solveDocument } from '../assembly/fromDocument'
import { motionDofs } from '../assembly/motion'
import { findFeature, pathKey } from '../doc/model'
import { useStore } from '../doc/store'
import type { JointFeature, OkcDocument } from '../doc/types'

export const useJointAnimation = create<{ jointId: string | null }>(() => ({ jointId: null }))

let stopCurrent: (() => void) | null = null

export function stopJointAnimation() {
  stopCurrent?.()
}

function travel(joint: JointFeature, doc: OkcDocument): (seconds: number) => number {
  const spec = motionDofs(joint.motion)[0]
  const limit = joint.limits[0] ?? {}
  const start = joint.values[0] ?? 0
  if (limit.min !== undefined && limit.max !== undefined && limit.max > limit.min) {
    const low = limit.min
    const span = limit.max - limit.min
    const period = spec.kind === 'rotate' ? Math.max(1.5, span / 120) : 2.5
    const phase = Math.min(1, Math.max(0, (start - low) / span)) / 2
    return (seconds) => {
      const t = (seconds / period + phase) % 1
      return low + span * (t < 0.5 ? t * 2 : 2 - t * 2)
    }
  }
  if (spec.kind === 'rotate') {
    const low = limit.min
    const high = limit.max
    if (low === undefined && high === undefined) return (seconds) => start + 120 * seconds
    const reach = 180
    const from = low ?? start - reach
    const to = high ?? start + reach
    return travel({ ...joint, limits: [{ min: from, max: to }] }, doc)
  }
  const reach = slideReach(joint, doc)
  const from = limit.min ?? start - reach
  const to = limit.max ?? start + reach
  return travel({ ...joint, limits: [{ min: from, max: to }] }, doc)
}

function slideReach(joint: JointFeature, doc: OkcDocument): number {
  const state = useStore.getState()
  const key = pathKey(joint.one.occurrencePath)
  let size = 0
  for (const instance of state.instances) {
    if (pathKey(instance.path) !== key) continue
    const bounds = state.meshes.get(instance.meshKey)?.bounds
    if (!bounds) continue
    size = Math.max(size, bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
  }
  return size > 0 ? size / 2 : doc.units === 'in' ? 25.4 : 20
}

export function animateJoint(jointId: string): string | null {
  stopJointAnimation()
  const store = useStore.getState()
  const joint = findFeature(store.doc, jointId)
  if (joint?.kind !== 'joint') return 'Pick a joint to animate.'
  if (!motionDofs(joint.motion).length) return 'A rigid joint has no motion to animate.'
  if (joint.locked) return 'This joint is locked. Unlock it to animate it.'
  const base = store.doc
  const valueAt = travel(joint, base)
  const spins =
    motionDofs(joint.motion)[0].kind === 'rotate' &&
    joint.limits[0]?.min === undefined &&
    joint.limits[0]?.max === undefined
  const began = performance.now()
  let frame = 0
  const tick = (now: number) => {
    const state = useStore.getState()
    const live = findFeature(state.doc, jointId)
    const current = live?.kind === 'joint' ? (live.values[0] ?? 0) : 0
    const target = valueAt((now - began) / 1000)
    const value = spins ? current + ((((target - current) % 360) + 540) % 360) - 180 : target
    const result = solveDocument(state.doc, { drive: [{ jointId, dof: 0, value }] })
    state.commit((draft) => applyAssemblyResult(draft, result), { transient: true })
    frame = requestAnimationFrame(tick)
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointerdown', stop, true)
    window.removeEventListener('keydown', stop, true)
    stopCurrent = null
    useJointAnimation.setState({ jointId: null })
    useStore.getState().commit(
      (draft) => {
        draft.occurrences = structuredClone(base.occurrences)
        for (const feature of draft.timeline) {
          const original = findFeature(base, feature.id)
          if (feature.kind === 'joint' && original?.kind === 'joint') {
            feature.values = [...original.values]
          }
        }
      },
      { transient: true },
    )
  }
  stopCurrent = stop
  useJointAnimation.setState({ jointId })
  window.addEventListener('pointerdown', stop, true)
  window.addEventListener('keydown', stop, true)
  frame = requestAnimationFrame(tick)
  return null
}
