import { analyzeMesh } from '../mesh/analysis'
import { decodeMesh, encodeMesh, meshDataId } from '../mesh/blob'
import { meshDisplay } from '../mesh/display'
import { TriangleLocator } from '../mesh/closest'
import { thinnestWall } from '../mesh/thickness'
import { planeCut } from '../mesh/cut'
import { importMeshFile } from '../mesh/import'
import { parseObj, writeObj } from '../mesh/obj'
import { reverseNormals, separateComponents } from '../mesh/operations'
import { boxMesh, torusMesh, uvSphereMesh } from '../mesh/primitives'
import { reduceMesh } from '../mesh/reduce'
import { meanEdgeLength, remeshMesh } from '../mesh/remesh'
import { repairMesh } from '../mesh/repair'
import { smoothMesh } from '../mesh/smooth'
import { parseStl, writeStlAscii, writeStlBinary } from '../mesh/stl'
import { parse3mf, write3mf } from '../mesh/threemf'
import { cloneMesh, createMesh, mergeMeshes, triangleCount, type TriMesh } from '../mesh/types'
import type { TestResult } from './selftest'

export function runMeshTest(): TestResult[] {
  const results: TestResult[] = []
  let current = ''
  const check = (pass: boolean, detail: string) =>
    results.push({ name: `Mesh: ${current}`, pass, detail })
  const test = (name: string, body: () => void) => {
    current = name
    try {
      body()
    } catch (error) {
      check(false, `threw: ${(error as Error).stack ?? String(error)}`)
    }
  }
  const near = (actual: number, expected: number, label: string, tolerance: number) =>
    check(
      Math.abs(actual - expected) <= tolerance,
      `${label}: ${Number(actual.toFixed(6))} against ${expected}`,
    )
  const solid = (mesh: TriMesh, label: string) => {
    const report = analyzeMesh(mesh)
    check(
      report.watertight && report.outward,
      `${label}: watertight ${report.watertight}, outward ${report.outward}, ${report.boundaryEdgeCount} open edges`,
    )
    return report
  }

  const box = boxMesh([20, 10, 5], [0, 0, 0], 2)

  test('a box mesh is a closed outward solid', () => {
    const report = solid(box, 'box')
    near(report.volume, 1000, 'volume', 1e-9)
    near(report.area, 2 * (200 + 50 + 100), 'area', 1e-9)
    check(report.componentCount === 1, `${report.componentCount} components`)
  })

  test('binary STL round-trips and welds back to a solid', () => {
    const read = parseStl(writeStlBinary(box))
    check(triangleCount(read) === triangleCount(box), `${triangleCount(read)} triangles`)
    near(solid(read, 'read back').volume, 1000, 'volume', 1e-3)
  })

  test('ASCII STL round-trips', () => {
    const read = parseStl(new TextEncoder().encode(writeStlAscii(box, 'box')))
    near(solid(read, 'read back').volume, 1000, 'volume', 1e-3)
  })

  test('STL in inches comes in as millimetres', () => {
    const read = parseStl(writeStlBinary(boxMesh([1, 1, 1])), { unit: 'in' })
    near(analyzeMesh(read).volume, 25.4 ** 3, 'volume', 1e-2)
  })

  test('OBJ round-trips', () => {
    const read = parseObj(writeObj(box, { name: 'box' }))
    near(solid(read, 'read back').volume, 1000, 'volume', 1e-6)
  })

  test('3MF round-trips every body with its name', () => {
    const sphere = uvSphereMesh(4, 24, 12, [40, 0, 0])
    const bodies = parse3mf(
      write3mf([
        { name: 'Box', mesh: box },
        { name: 'Ball', mesh: sphere },
      ]),
    )
    check(
      bodies.map((body) => body.name).join(',') === 'Box,Ball',
      bodies.map((b) => b.name).join(','),
    )
    near(solid(bodies[0].mesh, 'box').volume, 1000, 'box volume', 1e-3)
    solid(bodies[1].mesh, 'ball')
  })

  test('the import picks a reader from the file name', () => {
    const [stl] = importMeshFile('part.STL', writeStlBinary(box))
    check(stl.name === 'part', stl.name)
    let refused = ''
    try {
      importMeshFile('part.ply', new Uint8Array(4))
    } catch (error) {
      refused = (error as Error).message
    }
    check(refused.includes('STL, OBJ and 3MF'), refused || 'no error')
  })

  test('a sphere mesh has close to the true volume', () => {
    const report = solid(uvSphereMesh(10, 64, 32), 'sphere')
    near(report.volume / ((4 / 3) * Math.PI * 1000), 1, 'volume ratio', 0.02)
  })

  test('repair welds, reorients and closes a damaged box', () => {
    const soup: number[] = []
    const positions = box.positions
    for (let t = 0; t < box.triangles.length; t += 3) {
      if (t === 0) continue
      const ids = [box.triangles[t], box.triangles[t + 1], box.triangles[t + 2]]
      if (t === 6) ids.reverse()
      for (const id of ids)
        soup.push(positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2])
    }
    const broken = createMesh(
      soup,
      Array.from({ length: soup.length / 3 }, (_, i) => i),
    )
    check(!analyzeMesh(broken).watertight, 'the broken box leaks')
    const { mesh, report } = repairMesh(broken)
    check(report.filledHoles === 1 && report.watertight, JSON.stringify(report))
    near(solid(mesh, 'repaired').volume, 1000, 'volume', 1e-6)
  })

  test('a plane cut splits a box into two capped halves', () => {
    const { above, below, capLoops } = planeCut(
      box,
      { origin: [0, 0, 2], normal: [0, 0, 1] },
      { cap: true },
    )
    check(capLoops === 2, `${capLoops} cap loops`)
    near(solid(above, 'above').volume, 600, 'above volume', 1e-6)
    near(solid(below, 'below').volume, 400, 'below volume', 1e-6)
  })

  test('a plane cut through a torus caps each ring', () => {
    const torus = torusMesh(20, 5, 64, 32)
    const whole = analyzeMesh(torus).volume
    const { above, below, capLoops, unmatchedLoops } = planeCut(
      torus,
      { origin: [0, 0, 0], normal: [0, 0, 1] },
      { cap: true },
    )
    check(capLoops === 2 && unmatchedLoops === 0, `${capLoops} caps, ${unmatchedLoops} unmatched`)
    near(
      solid(above, 'above').volume + solid(below, 'below').volume,
      whole,
      'volumes add up',
      whole * 1e-6,
    )
  })

  test('an uncapped cut leaves open halves', () => {
    const { above } = planeCut(box, { origin: [0, 0, 2], normal: [0, 0, 1] })
    check(!analyzeMesh(above).watertight, 'open')
  })

  test('separate finds each piece and reverse turns a solid inside out', () => {
    const pair = mergeMeshes([box, boxMesh([5, 5, 5], [50, 0, 0])])
    const pieces = separateComponents(pair)
    check(pieces.length === 2, `${pieces.length} pieces`)
    near(analyzeMesh(reverseNormals(box)).volume, -1000, 'reversed volume', 1e-9)
  })

  const radii = (mesh: TriMesh, centre = [0, 0, 0]) => {
    const out: number[] = []
    for (let i = 0; i < mesh.positions.length; i += 3) {
      out.push(
        Math.hypot(
          mesh.positions[i] - centre[0],
          mesh.positions[i + 1] - centre[1],
          mesh.positions[i + 2] - centre[2],
        ),
      )
    }
    return out
  }
  const spread = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
  }

  test('smoothing pulls a noisy sphere back towards round without shrinking it', () => {
    const sphere = uvSphereMesh(10, 48, 24)
    const noisy = cloneMesh(sphere)
    for (let v = 0; v < noisy.positions.length / 3; v++) {
      const factor = 1 + 0.04 * Math.sin(v * 12.9898)
      for (let k = 0; k < 3; k++) noisy.positions[v * 3 + k] *= factor
    }
    const smooth = smoothMesh(noisy, { iterations: 10, strength: 0.5 })
    check(
      spread(radii(smooth)) < spread(radii(noisy)) * 0.5,
      `radius spread ${spread(radii(noisy)).toFixed(4)} to ${spread(radii(smooth)).toFixed(4)}`,
    )
    near(analyzeMesh(smooth).volume / analyzeMesh(sphere).volume, 1, 'volume ratio', 0.05)
  })

  test('smoothing leaves an open edge where it is', () => {
    const { above } = planeCut(uvSphereMesh(10, 48, 24), { origin: [0, 0, 0], normal: [0, 0, 1] })
    const smooth = smoothMesh(above, { iterations: 5 })
    let lowest = Infinity
    for (let i = 2; i < smooth.positions.length; i += 3)
      lowest = Math.min(lowest, smooth.positions[i])
    near(lowest, 0, 'the rim stays on the cut', 1e-9)
  })

  test('reduce takes a sphere down to a quarter and keeps it closed and round', () => {
    const sphere = uvSphereMesh(10, 64, 32)
    const start = triangleCount(sphere)
    const { mesh } = reduceMesh(sphere, { proportion: 0.25 })
    check(triangleCount(mesh) <= Math.ceil(start / 4) + 1, `${start} to ${triangleCount(mesh)}`)
    const report = solid(mesh, 'reduced')
    near(report.volume / analyzeMesh(sphere).volume, 1, 'volume ratio', 0.03)
  })

  test('reduce folds flat faces down with no error', () => {
    const fine = boxMesh([20, 10, 5], [0, 0, 0], 6)
    const { mesh, maxError } = reduceMesh(fine, { targetTriangles: 12 })
    check(triangleCount(mesh) <= 14, `${triangleCount(fine)} to ${triangleCount(mesh)}`)
    near(solid(mesh, 'reduced box').volume, 1000, 'volume', 1e-6)
    near(maxError, 0, 'error', 1e-6)
  })

  test('reduce stops at the allowed deviation', () => {
    const sphere = uvSphereMesh(10, 64, 32)
    const { mesh, maxError } = reduceMesh(sphere, { targetTriangles: 8, maxError: 0.02 })
    check(
      maxError <= 0.02 && triangleCount(mesh) > 8,
      `${triangleCount(mesh)} triangles, error ${maxError.toFixed(4)}`,
    )
    const worst = Math.max(...radii(mesh).map((r) => Math.abs(r - 10)))
    check(worst < 0.2, `worst radius error ${worst.toFixed(4)}`)
  })

  test('remesh evens a box out to the asked edge length and keeps its corners', () => {
    const plain = boxMesh([20, 10, 5])
    const mesh = remeshMesh(plain, { edgeLength: 1.5, iterations: 5 })
    near(solid(mesh, 'remeshed box').volume, 1000, 'volume', 1e-6)
    const mean = meanEdgeLength(mesh)
    check(mean > 1.1 && mean < 1.9, `mean edge ${mean.toFixed(3)}`)
    const corners = [0, 20].flatMap((x) => [0, 10].flatMap((y) => [0, 5].map((z) => [x, y, z])))
    const kept = corners.filter((corner) => {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (
          Math.hypot(
            mesh.positions[i] - corner[0],
            mesh.positions[i + 1] - corner[1],
            mesh.positions[i + 2] - corner[2],
          ) < 1e-9
        )
          return true
      }
      return false
    })
    check(kept.length === 8, `${kept.length} of 8 corners kept`)
  })

  test('remesh keeps a sphere on its surface', () => {
    const sphere = uvSphereMesh(10, 32, 16)
    const mesh = remeshMesh(sphere, { edgeLength: 1.2, iterations: 4 })
    solid(mesh, 'remeshed sphere')
    const locator = new TriangleLocator(sphere)
    let worst = 0
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const found = locator.closestPoint([
        mesh.positions[i],
        mesh.positions[i + 1],
        mesh.positions[i + 2],
      ])
      worst = Math.max(worst, Math.sqrt(found.distanceSquared))
    }
    check(worst < 1e-6, `farthest from the original surface ${worst.toExponential(2)}`)
    const mean = meanEdgeLength(mesh)
    check(mean > 0.9 && mean < 1.5, `mean edge ${mean.toFixed(3)}`)
  })

  test('mesh data encodes compactly and decodes to the same mesh', () => {
    const sphere = uvSphereMesh(10, 48, 24)
    const encoded = encodeMesh(sphere)
    const decoded = decodeMesh(encoded)
    check(
      decoded.triangles.length === sphere.triangles.length &&
        decoded.triangles.every((value, index) => value === sphere.triangles[index]),
      'same triangles',
    )
    let worst = 0
    for (let i = 0; i < sphere.positions.length; i++) {
      worst = Math.max(worst, Math.abs(decoded.positions[i] - sphere.positions[i]))
    }
    check(worst < 1e-5, `largest position change ${worst.toExponential(2)}`)
    const bytes = encoded.positions.length + encoded.triangles.length
    const raw = sphere.positions.length * 8 + sphere.triangles.length * 4
    check(bytes < raw, `${bytes} characters against ${raw} raw bytes`)
    check(meshDataId(encodeMesh(sphere)) === meshDataId(encoded), 'the same mesh gets the same id')
    check(meshDataId(encodeMesh(box)) !== meshDataId(encoded), 'a different mesh gets another id')
  })

  test('a box displays with flat faces and its twelve edges', () => {
    const display = meshDisplay(box)
    check(display.triangles.length === box.triangles.length, 'every triangle kept')
    check(display.edgeGroups.length === 12, `${display.edgeGroups.length} edge chains`)
    let flat = true
    for (let i = 0; i < display.normals.length; i += 3) {
      const axes = [display.normals[i], display.normals[i + 1], display.normals[i + 2]].map(
        Math.abs,
      )
      if (Math.max(...axes) < 0.9999) flat = false
    }
    check(flat, 'every normal points straight out of a face')
  })

  test('a sphere displays smooth with no edges drawn', () => {
    const sphere = uvSphereMesh(10, 48, 24)
    const display = meshDisplay(sphere)
    check(display.edgeGroups.length === 0, `${display.edgeGroups.length} edge chains`)
    check(
      display.vertices.length === sphere.positions.length,
      `${display.vertices.length / 3} display vertices for ${sphere.positions.length / 3}`,
    )
    const open = meshDisplay(planeCut(sphere, { origin: [0, 0, 0], normal: [0, 0, 1] }).above)
    check(open.edgeGroups.length === 1, `the open rim is one chain (${open.edgeGroups.length})`)
  })

  test('a ray finds the first face it crosses and misses what it should', () => {
    const locator = new TriangleLocator(boxMesh([10, 10, 10], [0, 0, 0], 3))
    const below = locator.raycast([5, 5, -5], [0, 0, 1])
    const inside = locator.raycast([5, 5, 5], [0, 0, 1])
    const slanted = locator.raycast([5, 5, 5], [Math.SQRT1_2, 0, Math.SQRT1_2])
    const beside = locator.raycast([50, 50, 5], [0, 0, 1])
    const short = locator.raycast([5, 5, -5], [0, 0, 1], 4)
    check(
      !!below && Math.abs(below.distance - 5) < 1e-9 && Math.abs(below.point[2]) < 1e-9,
      `from below: ${below?.distance}`,
    )
    check(!!inside && Math.abs(inside.distance - 5) < 1e-9, `from inside: ${inside?.distance}`)
    check(
      !!slanted && Math.abs(slanted.distance - 5 * Math.SQRT2) < 1e-9,
      `at 45 degrees: ${slanted?.distance}`,
    )
    check(
      beside === null && short === null,
      'a ray past the box, and one too short to reach it, hit nothing',
    )
  })

  test('the thinnest wall is found where it is, not averaged', () => {
    const plate = thinnestWall(boxMesh([20, 20, 1.5], [0, 0, 0], 4))
    const cube = thinnestWall(boxMesh([10, 10, 10]))
    const hollow = thinnestWall(
      mergeMeshes([boxMesh([20, 20, 20]), reverseNormals(boxMesh([16, 16, 17], [2, 2, 2]))]),
    )
    check(!!plate && Math.abs(plate.thickness - 1.5) < 1e-9, `plate ${plate?.thickness}`)
    check(!!cube && Math.abs(cube.thickness - 10) < 1e-9, `cube ${cube?.thickness}`)
    check(
      !!hollow &&
        Math.abs(hollow.thickness - 1) < 1e-9 &&
        Math.abs(hollow.from[2] - 20) < 1e-9 &&
        Math.abs(hollow.to[2] - 19) < 1e-9,
      `a box with 2 mm sides and a 1 mm lid reads ${hollow?.thickness}, from z ${hollow?.from[2]} to ${hollow?.to[2]}`,
    )
  })

  return results
}
