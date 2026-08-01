import { useEffect, useState } from 'react'
import { useStore } from '../doc/store'

/** Below this, showing a bar is more distracting than the wait it covers. */
const SHOW_AFTER_MS = 500

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
  const label = busy ?? (building ? 'Working out the shape' : null)
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
    // Only start counting once the bar is up, so the first thing the user sees
    // is not already several seconds in.
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

  return (
    <div className="build-progress" role="status" aria-live="polite">
      <div className="build-progress-text">
        <span>{label}…</span>
        {seconds >= 2 && <span className="build-progress-time">{seconds}s</span>}
      </div>
      <div className="build-progress-track">
        <div className="build-progress-bar" />
      </div>
    </div>
  )
}
