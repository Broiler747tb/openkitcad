export type Axis = [number, number, number]
export interface CubeZone {
  direction: Axis
  points: Axis[]
  kind: 'face' | 'edge' | 'corner'
  label?: string
  right?: Axis
  down?: Axis
}

const FACES = [
  { label: 'TOP', right: [1, 0, 0], down: [0, -1, 0], direction: [0, 0, 1] },
  { label: 'BOTTOM', right: [1, 0, 0], down: [0, 1, 0], direction: [0, 0, -1] },
  { label: 'FRONT', right: [1, 0, 0], down: [0, 0, -1], direction: [0, -1, 0] },
  { label: 'BACK', right: [-1, 0, 0], down: [0, 0, -1], direction: [0, 1, 0] },
  { label: 'RIGHT', right: [0, 1, 0], down: [0, 0, -1], direction: [1, 0, 0] },
  { label: 'LEFT', right: [0, -1, 0], down: [0, 0, -1], direction: [-1, 0, 0] },
] as Array<{ label: string; right: Axis; down: Axis; direction: Axis }>

const INSET = 0.76
export const CUBE_ZONES: CubeZone[] = FACES.map((face) => ({
  ...face,
  kind: 'face',
  points: [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(
    ([x, y]) =>
      face.direction.map(
        (value, axis) => value + INSET * (x * face.right[axis] + y * face.down[axis]),
      ) as Axis,
  ),
}))

for (let a = 0; a < 3; a++)
  for (let b = a + 1; b < 3; b++)
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        const direction: Axis = [0, 0, 0]
        direction[a] = sa
        direction[b] = sb
        const points = [
          [1, INSET, -INSET],
          [INSET, 1, -INSET],
          [INSET, 1, INSET],
          [1, INSET, INSET],
        ].map(([x, y, z]) => {
          const point: Axis = [0, 0, 0]
          point[a] = sa * x
          point[b] = sb * y
          point[3 - a - b] = z
          return point
        })
        CUBE_ZONES.push({ direction, points, kind: 'edge' })
      }

for (const x of [-1, 1])
  for (const y of [-1, 1])
    for (const z of [-1, 1])
      CUBE_ZONES.push({
        direction: [x, y, z],
        kind: 'corner',
        points: [
          [x, y * INSET, z * INSET],
          [x * INSET, y, z * INSET],
          [x * INSET, y * INSET, z],
        ],
      })

export function projectCube(view: number[], point: Axis): Axis {
  return [
    view[0] * point[0] + view[1] * point[1] + view[2] * point[2],
    -(view[3] * point[0] + view[4] * point[1] + view[5] * point[2]),
    view[6] * point[0] + view[7] * point[1] + view[8] * point[2],
  ]
}

export function directionLabels(direction: Axis): string[] {
  return [
    direction[2] > 0 ? 'TOP' : direction[2] < 0 ? 'BOTTOM' : '',
    direction[1] < 0 ? 'FRONT' : direction[1] > 0 ? 'BACK' : '',
    direction[0] > 0 ? 'RIGHT' : direction[0] < 0 ? 'LEFT' : '',
  ].filter(Boolean)
}
