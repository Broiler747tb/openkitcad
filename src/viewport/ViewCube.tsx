import { useEffect, useRef } from 'react'

export type CubeFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

type Axis = [number, number, number]

const FACES: Array<{ id: CubeFace; label: string; right: Axis; down: Axis; normal: Axis }> = [
  { id: 'top', label: 'TOP', right: [1, 0, 0], down: [0, -1, 0], normal: [0, 0, 1] },
  { id: 'bottom', label: 'BOTTOM', right: [1, 0, 0], down: [0, 1, 0], normal: [0, 0, -1] },
  { id: 'front', label: 'FRONT', right: [1, 0, 0], down: [0, 0, -1], normal: [0, -1, 0] },
  { id: 'back', label: 'BACK', right: [-1, 0, 0], down: [0, 0, -1], normal: [0, 1, 0] },
  { id: 'right', label: 'RIGHT', right: [0, 1, 0], down: [0, 0, -1], normal: [1, 0, 0] },
  { id: 'left', label: 'LEFT', right: [0, -1, 0], down: [0, 0, -1], normal: [-1, 0, 0] },
]

const SIZE = 64

function transformFor(view: number[], face: (typeof FACES)[number]): string {
  const apply = (v: Axis): Axis => [
    view[0] * v[0] + view[1] * v[1] + view[2] * v[2],
    -(view[3] * v[0] + view[4] * v[1] + view[5] * v[2]),
    view[6] * v[0] + view[7] * v[1] + view[8] * v[2],
  ]
  const right = apply(face.right)
  const down = apply(face.down)
  const normal = apply(face.normal)
  const h = SIZE / 2
  return `matrix3d(${right[0]},${right[1]},${right[2]},0,${down[0]},${down[1]},${down[2]},0,${normal[0]},${normal[1]},${normal[2]},0,${normal[0] * h},${normal[1] * h},${normal[2] * h},1)`
}

export function ViewCube({
  subscribe,
}: {
  subscribe: (listener: (view: number[]) => void) => () => void
}) {
  const faceRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(
    () =>
      subscribe((view) => {
        FACES.forEach((face, index) => {
          const element = faceRefs.current[index]
          if (!element) return
          element.style.transform = transformFor(view, face)
          const facing =
            view[6] * face.normal[0] + view[7] * face.normal[1] + view[8] * face.normal[2]
          element.style.visibility = facing > 0.02 ? 'visible' : 'hidden'
        })
      }),
    [subscribe],
  )

  const go = (view: string) => window.dispatchEvent(new CustomEvent('okc:view', { detail: view }))

  return (
    <div className="view-cube" aria-label="View cube">
      <button
        className="view-cube-home"
        title="Home view"
        aria-label="Home view"
        onClick={() => go('iso')}
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <path
            d="M2 8L8 2.5L14 8M4 7V13.5H12V7"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="view-cube-stage">
        <div className="view-cube-body">
          {FACES.map((face, index) => (
            <button
              key={face.id}
              ref={(element) => {
                faceRefs.current[index] = element
              }}
              className="view-cube-face"
              title={`Look at the ${face.label.toLowerCase()}`}
              onClick={() => go(face.id)}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
