/**
 * File format writers.
 *
 * replicad only exports STEP, so everything else here is written by hand. That
 * is less work than it sounds - these are simple formats - and it keeps the
 * bundle small and the output predictable.
 */
import { zipSync, strToU8 } from 'fflate'
import type { MeshData, ProjectionResult } from '../kernel/types'

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

/**
 * Binary STL: 80-byte header, triangle count, then 50 bytes per triangle.
 * Normals are recomputed per facet rather than averaged from the vertex
 * normals, because STL facet normals must be flat - handing a slicer smoothed
 * normals makes some of them mis-detect the surface orientation.
 */
export function meshToBinarySTL(mesh: MeshData, name = 'OpenKitCAD'): ArrayBuffer {
  const triangleCount = mesh.triangles.length / 3
  const buffer = new ArrayBuffer(84 + triangleCount * 50)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  const header = `Exported by OpenKitCAD - ${name}`.slice(0, 79)
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i)
  view.setUint32(80, triangleCount, true)

  let offset = 84
  const v = mesh.vertices
  for (let t = 0; t < triangleCount; t++) {
    const a = mesh.triangles[t * 3] * 3
    const b = mesh.triangles[t * 3 + 1] * 3
    const c = mesh.triangles[t * 3 + 2] * 3

    const ux = v[b] - v[a]
    const uy = v[b + 1] - v[a + 1]
    const uz = v[b + 2] - v[a + 2]
    const wx = v[c] - v[a]
    const wy = v[c + 1] - v[a + 1]
    const wz = v[c + 2] - v[a + 2]
    let nx = uy * wz - uz * wy
    let ny = uz * wx - ux * wz
    let nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len

    view.setFloat32(offset, nx, true)
    view.setFloat32(offset + 4, ny, true)
    view.setFloat32(offset + 8, nz, true)
    for (const [i, base] of [a, b, c].entries()) {
      view.setFloat32(offset + 12 + i * 12, v[base], true)
      view.setFloat32(offset + 16 + i * 12, v[base + 1], true)
      view.setFloat32(offset + 20 + i * 12, v[base + 2], true)
    }
    view.setUint16(offset + 48, 0, true)
    offset += 50
  }
  return buffer
}

// ---------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

/**
 * 3MF is a zip of XML. Worth supporting over STL alone because it carries real
 * units, so a slicer can never guess wrong about whether a part is millimetres
 * or inches.
 */
export function meshTo3MF(mesh: MeshData, name = 'part'): Uint8Array {
  const vertices: string[] = []
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    vertices.push(
      `<vertex x="${round(mesh.vertices[i])}" y="${round(mesh.vertices[i + 1])}" z="${round(mesh.vertices[i + 2])}"/>`,
    )
  }
  const triangles: string[] = []
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    triangles.push(
      `<triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}"/>`,
    )
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">OpenKitCAD</metadata>
<metadata name="Title">${escapeXml(name)}</metadata>
<resources>
<object id="1" type="model">
<mesh>
<vertices>${vertices.join('')}</vertices>
<triangles>${triangles.join('')}</triangles>
</mesh>
</object>
</resources>
<build><item objectid="1"/></build>
</model>`

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  })
}

// ---------------------------------------------------------------------------
// DXF
// ---------------------------------------------------------------------------

/**
 * DXF R12 with only LINE and CIRCLE entities. Deliberately primitive: every
 * laser cutter, CNC controller and drawing package made in the last thirty
 * years reads this, where newer entity types are a coin toss.
 */
export function projectionToDXF(projection: ProjectionResult): string {
  const out: string[] = []
  const code = (c: number | string, value: number | string) => {
    out.push(String(c), String(value))
  }

  code(0, 'SECTION')
  code(2, 'HEADER')
  code(9, '$ACADVER')
  code(1, 'AC1009')
  code(9, '$INSUNITS')
  code(70, 4) // 4 = millimetres
  code(0, 'ENDSEC')

  code(0, 'SECTION')
  code(2, 'ENTITIES')

  for (const poly of projection.polylines) {
    for (let i = 0; i + 1 < poly.length; i++) {
      code(0, 'LINE')
      code(8, 'CUT')
      code(10, round(poly[i][0]))
      code(20, round(poly[i][1]))
      code(30, 0)
      code(11, round(poly[i + 1][0]))
      code(21, round(poly[i + 1][1]))
      code(31, 0)
    }
  }
  for (const circle of projection.circles) {
    code(0, 'CIRCLE')
    code(8, 'CUT')
    code(10, round(circle.cx))
    code(20, round(circle.cy))
    code(30, 0)
    code(40, round(circle.r))
  }

  code(0, 'ENDSEC')
  code(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export function projectionToSVG(projection: ProjectionResult, margin = 5): string {
  const [minX, minY, maxX, maxY] = projection.bounds
  const w = maxX - minX + margin * 2
  const h = maxY - minY + margin * 2

  const body: string[] = []
  for (const poly of projection.polylines) {
    const d = poly
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p[0])} ${round(-p[1])}`)
      .join(' ')
    body.push(`<path d="${d}"/>`)
  }
  for (const c of projection.circles) {
    body.push(
      `<circle cx="${round(c.cx)}" cy="${round(-c.cy)}" r="${round(c.r)}"/>`,
    )
  }

  // The group flips Y back, because SVG measures downward and the model does not.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}mm" height="${round(h)}mm" viewBox="${round(minX - margin)} ${round(-maxY - margin)} ${round(w)} ${round(h)}">
<g fill="none" stroke="#000000" stroke-width="0.1">
${body.join('\n')}
</g>
</svg>`
}

// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  )
}
