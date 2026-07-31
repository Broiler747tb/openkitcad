/**
 * 1:1 printable drill template.
 *
 * The point of this file is that someone with no CNC and no laser can still
 * use the app: print the page at 100%, tape it to a project box, centre-punch
 * through the crosshairs, drill. That makes it the only export here whose
 * scale accuracy is safety-critical, so it writes points directly rather than
 * relying on a library that might helpfully "fit to page".
 */
import type { ProjectionResult } from '../kernel/types'

/** PostScript points per millimetre. */
const PT = 72 / 25.4
/** Bezier constant for approximating a quarter circle. */
const KAPPA = 0.5522847498

export interface TemplateOptions {
  title: string
  /** Page size in mm. A4 by default. */
  pageWidth?: number
  pageHeight?: number
  margin?: number
  /** Draw the outline as well as the holes. */
  includeOutline?: boolean
}

function circlePath(cx: number, cy: number, r: number): string {
  const k = r * KAPPA
  return [
    `${f(cx + r)} ${f(cy)} m`,
    `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`,
    `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`,
    `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`,
    `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`,
  ].join('\n')
}

function f(n: number): string {
  return (Math.round(n * 1000) / 1000).toString()
}

export function projectionToDrillTemplatePDF(
  projection: ProjectionResult,
  options: TemplateOptions,
): Uint8Array {
  const pageW = options.pageWidth ?? 210
  const pageH = options.pageHeight ?? 297
  const margin = options.margin ?? 12
  const [minX, minY, maxX, maxY] = projection.bounds

  // Centre the part on the page at true size. Never scaled: a template that
  // has been resized to fit is worse than useless.
  const partW = maxX - minX
  const partH = maxY - minY
  const offsetX = (pageW - partW) / 2 - minX
  const offsetY = (pageH - partH) / 2 - minY
  const fits = partW <= pageW - margin * 2 && partH <= pageH - margin * 2

  const to = (x: number, y: number): [number, number] => [
    (x + offsetX) * PT,
    (y + offsetY) * PT,
  ]

  const ops: string[] = []
  ops.push('0.4 w', '0 0 0 RG')

  if (options.includeOutline !== false) {
    ops.push('0.25 w', '0.55 0.55 0.55 RG')
    for (const poly of projection.polylines) {
      poly.forEach((p, i) => {
        const [x, y] = to(p[0], p[1])
        ops.push(`${f(x)} ${f(y)} ${i === 0 ? 'm' : 'l'}`)
      })
      ops.push('S')
    }
  }

  // Holes: a true-size circle plus a crosshair to centre-punch through.
  ops.push('0.5 w', '0 0 0 RG')
  for (const c of projection.circles) {
    const [cx, cy] = to(c.cx, c.cy)
    ops.push(circlePath(cx, cy, c.r * PT), 'S')
    const arm = Math.max(c.r * PT + 3 * PT, 5 * PT)
    ops.push('0.3 w')
    ops.push(`${f(cx - arm)} ${f(cy)} m ${f(cx + arm)} ${f(cy)} l S`)
    ops.push(`${f(cx)} ${f(cy - arm)} m ${f(cx)} ${f(cy + arm)} l S`)
    ops.push('0.5 w')
  }

  // A 100 mm ruler so the user can confirm the printer did not rescale.
  const rulerY = margin * PT
  const rulerX = margin * PT
  ops.push('0.5 w', '0 0 0 RG')
  ops.push(`${f(rulerX)} ${f(rulerY)} m ${f(rulerX + 100 * PT)} ${f(rulerY)} l S`)
  for (let i = 0; i <= 100; i += 10) {
    const x = rulerX + i * PT
    const h = i % 50 === 0 ? 4 * PT : 2 * PT
    ops.push(`${f(x)} ${f(rulerY)} m ${f(x)} ${f(rulerY + h)} l S`)
  }

  const text = (x: number, y: number, size: number, s: string) =>
    `BT /F1 ${size} Tf ${f(x)} ${f(y)} Td (${s.replace(/[()\\]/g, '\\$&')}) Tj ET`

  ops.push(text(rulerX, rulerY - 9, 8, 'This line is exactly 100 mm. Print at 100% - do not scale to fit.'))
  ops.push(text(margin * PT, (pageH - margin) * PT, 12, options.title))
  ops.push(
    text(
      margin * PT,
      (pageH - margin) * PT - 13,
      8,
      `${projection.circles.length} hole(s). Part is ${partW.toFixed(1)} x ${partH.toFixed(1)} mm.` +
        (fits ? '' : '  WARNING: the part is larger than this page and has been cropped.'),
    ),
  )

  const content = ops.join('\n')
  return assemblePdf(content, pageW * PT, pageH * PT)
}

/** Minimal single-page PDF with one base-14 font. */
function assemblePdf(content: string, widthPt: number, heightPt: number): Uint8Array {
  const encoder = new TextEncoder()
  const objects: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${f(widthPt)} ${f(heightPt)}]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>`,
    `<</Length ${encoder.encode(content).length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return encoder.encode(pdf)
}
