import { useEffect, useState } from 'react'
import { useStore } from '../doc/store'
import { findFeature } from '../doc/model'
import { stopKernel, useKernelActivity } from '../kernel/api'

/** Below this, showing a bar is more distracting than the wait it covers. */
const SHOW_AFTER_MS = 500
const STOP_AFTER_S = 10

export function stopBuild(): void {
  const stopped = stopKernel()
  if (!stopped || stopped.kind === 'preview') return
  const store = useStore.getState()
  const feature = stopped.step ? findFeature(store.doc, stopped.step) : undefined
  if (!feature) {
    store.setStatus(`Stopped the geometry engine after ${stopped.seconds} s.`)
    return
  }
  store.updateFeature(feature.id, { suppressed: true })
  store.setStatus(
    `Stopped "${feature.name}" after ${stopped.seconds} s and turned it off. Edit it, then turn it back on.`,
  )
}

/**
 * Progress for anything slow.
 *
 * The bar is deliberately indeterminate. OpenCascade does not report how far
 * through a boolean it is, so a percentage would be a number made up to look
 * reassuring - and one that stalls at 90% is worse than no number at all. What
 * is shown instead is what it is doing and how long it has been doing it, both
 * of which are true.
 */
export function BuildProgress() {
  const building = useStore((s) => s.building)
  const busy = useStore((s) => s.busy)
  const activity = useKernelActivity((s) => s.activity)
  const label =
    busy ??
    (activity?.kind === 'preview'
      ? 'Working out the preview'
      : building || activity
        ? 'Working out the shape'
        : null)
  const [shown, setShown] = useState(false)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!label) {
      setShown(false)
      setSeconds(0)
      return
    }
    const started = performance.now()
    const appear = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    const tick = setInterval(
      () => setSeconds(Math.floor((performance.now() - started) / 1000)),
      250,
    )
    return () => {
      clearTimeout(appear)
      clearInterval(tick)
    }
  }, [label])

  if (!shown || !label) return null
  const stuck = !busy && !!activity && seconds >= STOP_AFTER_S
  const step =
    stuck && activity?.step ? findFeature(useStore.getState().doc, activity.step)?.name : undefined

  return (
    <div className="build-progress" role="status" aria-live="polite">
      <div className="build-progress-text">
        <span>{step ? `Working out ${step}` : label}…</span>
        {seconds >= 2 && <span className="build-progress-time">{seconds}s</span>}
        {stuck && (
          <button className="build-progress-stop" onClick={stopBuild}>
            Stop
          </button>
        )}
      </div>
      <div className="build-progress-track">
        <div className="build-progress-bar" />
      </div>
    </div>
  )
}
