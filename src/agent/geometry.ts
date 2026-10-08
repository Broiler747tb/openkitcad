import type { BodyMesh } from '../kernel/types'

export function faceSummaries(body: BodyMesh) {
  const { vertices, triangles } = body.mesh
  return body.mesh.faceGroups
    .filter((group) => group.name)
    .map((group) => {
      const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
      const centre = [0, 0, 0]
      const normal = [0, 0, 0]
      let area = 0
      let first: number[] | undefined
      let planar = true
      for (let triangle = group.start; triangle < group.start + group.count; triangle++) {
        const points = Array.from({ length: 3 }, (_, corner) =>
          Array.from(
            { length: 3 },
            (_, axis) => vertices[triangles[triangle * 3 + corner] * 3 + axis],
          ),
        )
        for (const point of points)
          for (let axis = 0; axis < 3; axis++) {
            bounds[axis] = Math.min(bounds[axis], point[axis])
            bounds[axis + 3] = Math.max(bounds[axis + 3], point[axis])
          }
        const u = points[1].map((n, i) => n - points[0][i])
        const v = points[2].map((n, i) => n - points[0][i])
        const cross = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ]
        const size = Math.hypot(...cross)
        if (!size) continue
        const direction = cross.map((n) => n / size)
        if (!first) first = direction
        else if (direction.reduce((sum, n, i) => sum + n * first![i], 0) < 0.99999) planar = false
        area += size / 2
        for (let axis = 0; axis < 3; axis++) {
          centre[axis] += (((points[0][axis] + points[1][axis] + points[2][axis]) / 3) * size) / 2
          normal[axis] += cross[axis]
        }
      }
      const length = Math.hypot(...normal)
      return {
        kind: 'face',
        bodyId: body.bodyId,
        name: group.name,
        faceId: group.faceId,
        coordinateSpace: 'body-local',
        bounds: bounds.every(Number.isFinite) ? bounds : null,
        centre: area ? centre.map((n) => n / area) : null,
        normal: planar && length ? normal.map((n) => n / length) : null,
        area,
        planar,
        approximate: true,
      }
    })
}
