/**
 * The guided first run.
 *
 * Steps are data, not bespoke screens: each one is a title, a sentence, and a
 * predicate over application state that decides when it is finished. That means
 * the guide cannot drift out of step with the interface the way a scripted
 * click-through does, and adding a step is three lines rather than a component.
 */
import { useEffect, useState } from 'react'
import { useStore } from '../doc/store'

interface Step {
  title: string
  body: string
  done: (s: ReturnType<typeof useStore.getState>) => boolean
}

const STEPS: Step[] = [
  {
    title: 'Draw the outline',
    body: 'Press New sketch, then drag out a rectangle on the grid. It does not matter how big - we will fix the size next.',
    done: (s) =>
      s.doc.bodies.some((b) =>
        b.features.some((f) => f.kind === 'sketch' && f.sketch.entities.length > 0),
      ),
  },
  {
    title: 'Tell it the real size',
    body: 'Pick the Size tool, click one edge of your rectangle, and type the length you actually want. Do the same for an edge going the other way.',
    done: (s) =>
      s.doc.bodies.some((b) =>
        b.features.some(
          (f) =>
            f.kind === 'sketch' &&
            f.sketch.constraints.some((c) =>
              ['distance', 'distanceX', 'distanceY', 'diameter', 'radius'].includes(c.kind),
            ),
        ),
      ),
  },
  {
    title: 'Turn it into a solid',
    body: 'Press Make solid. Your flat outline becomes a real 3 mm plate. You can change the thickness afterwards in the panel on the right.',
    done: (s) => s.doc.bodies.some((b) => b.features.some((f) => f.kind === 'extrude')),
  },
  {
    title: 'Drop a board onto it',
    body: 'Open the Parts catalogue on the left and pick a board - a Raspberry Pi, say. Then set its Height so it sits above the plate.',
    done: (s) => s.doc.placements.length > 0,
  },
  {
    title: 'Let it do the tedious bit',
    body: 'With the board selected, press Mounting holes. The exact hole pattern is cut into your plate. Move the board and the holes follow it.',
    done: (s) =>
      s.doc.bodies.some((b) =>
        b.features.some((f) => f.kind === 'hole' || f.kind === 'standoff'),
      ),
  },
  {
    title: 'Take it away',
    body: 'Press Export. STL for a 3D printer, DXF for a laser cutter, STEP to carry on in another CAD package, or a drill template you can print at full size and tape onto a project box.',
    done: () => false,
  },
]

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const state = useStore()
  const step = STEPS[index]
  const complete = step.done(state)

  // Move on by itself once the user has actually done the thing.
  useEffect(() => {
    if (!complete) return
    const timer = setTimeout(() => {
      setIndex((i) => Math.min(i + 1, STEPS.length - 1))
    }, 900)
    return () => clearTimeout(timer)
  }, [complete, index])

  return (
    <div className="tutorial">
      <h4>{step.title}</h4>
      <p>{step.body}</p>
      <div className="tutorial-foot">
        <span className="step">
          {complete ? (
            <span className="tutorial-done">Done — nice one.</span>
          ) : (
            `Step ${index + 1} of ${STEPS.length}`
          )}
        </span>
        <button
          className="tb"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Back
        </button>
        {index < STEPS.length - 1 ? (
          <button className="tb active" onClick={() => setIndex((i) => i + 1)}>
            Skip
          </button>
        ) : (
          <button className="tb active" onClick={onClose}>
            Finish
          </button>
        )}
        <button className="tb" title="Close the guide" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}
