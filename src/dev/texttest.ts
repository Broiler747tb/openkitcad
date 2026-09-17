import * as Comlink from 'comlink'
import { Font, Glyph, Path, parse } from 'opentype.js'
import type { Vec2 } from '../core/math'
import type { Feature, OkcDocument, PlaneRef } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { BodyMesh, EvaluateResult, KernelApi } from '../kernel/types'
import { singleFace, textOutline } from '../sketch/fonts'
import { cachedRegions } from '../sketch/regions'
import {
  cachedTextProfiles,
  flattenContour,
  placedContours,
  signedArea,
  textKey,
  textProfileAt,
} from '../sketch/text'
import type { Sketch2D, TextEntity, TextOutline } from '../sketch/types'
import { emptySketch } from '../sketch/types'
import type { TestResult } from './selftest'

type Draw = (path: Path) => void

function square(x0: number, y0: number, x1: number, y1: number, clockwise: boolean): Draw {
  return (path) => {
    const corners: Vec2[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
    const ordered = clockwise ? [...corners].reverse() : corners
    path.moveTo(ordered[0][0], ordered[0][1])
    for (const [x, y] of ordered.slice(1)) path.lineTo(x, y)
    path.close()
  }
}

function glyph(name: string, character: string | null, advance: number, draws: Draw[]): Glyph {
  const path = new Path()
  for (const draw of draws) draw(path)
  return new Glyph({
    name,
    unicode: character ? character.codePointAt(0) : undefined,
    advanceWidth: advance,
    path,
  })
}

export function testFont(): Font {
  const bowl: Draw = (path) => {
    path.moveTo(0, 0)
    path.lineTo(0, 100)
    path.lineTo(40, 100)
    path.quadraticCurveTo(80, 100, 80, 50)
    path.quadraticCurveTo(80, 0, 40, 0)
    path.close()
  }
  const font = new Font({
    familyName: 'Okc Test',
    styleName: 'Regular',
    unitsPerEm: 125,
    ascender: 110,
    descender: -15,
    glyphs: [
      glyph('.notdef', null, 50, []),
      glyph('space', ' ', 40, []),
      glyph('H', 'H', 90, [square(0, 0, 80, 100, true)]),
      glyph('I', 'I', 40, [square(0, 0, 20, 100, true)]),
      glyph('O', 'O', 100, [square(0, 0, 80, 100, true), square(20, 20, 60, 80, false)]),
      glyph('X', 'X', 100, [square(0, 40, 80, 60, true), square(30, 0, 50, 100, true)]),
      glyph('D', 'D', 100, [bowl]),
      glyph('S', 'S', 100, [
        (path) => {
          path.moveTo(0, 0)
          path.lineTo(80, 100)
          path.lineTo(0, 100)
          path.lineTo(80, 0)
          path.close()
        },
      ]),
    ],
  })
  font.kerningPairs = {}
  return font
}

function textEntity(id: string, text: string, outline: TextOutline, height = 10): TextEntity {
  return {
    id,
    kind: 'text',
    p: `${id}-at`,
    text,
    height,
    angle: 0,
    font: 'Okc Test Regular',
    outline,
    construction: false,
  }
}

function sketchWith(
  texts: Array<{ entity: TextEntity; at: Vec2 }>,
  rectangle?: number[],
): Sketch2D {
  const sketch = emptySketch()
  for (const { entity, at } of texts) {
    sketch.points.push({ id: entity.p, x: at[0], y: at[1] })
    sketch.entities.push(entity)
  }
  if (rectangle) {
    const [x0, y0, x1, y1] = rectangle
    const corners: Vec2[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
    corners.forEach(([x, y], i) => sketch.points.push({ id: `r${i}`, x, y }))
    corners.forEach((_, i) =>
      sketch.entities.push({
        id: `rl${i}`,
        kind: 'line',
        p1: `r${i}`,
        p2: `r${(i + 1) % 4}`,
        construction: false,
      }),
    )
  }
  return sketch
}

function textDoc(sketch: Sketch2D, profiles: string[] | undefined, distance = 2): OkcDocument {
  const doc = emptyDocument('Text')
  doc.components[0].bodies = [{ id: 'txt', name: 'Text', visible: true, colour: '#cccccc' }]
  const features: Feature[] = [
    {
      id: 'sk',
      name: 'Sketch',
      componentId: 'root',
      kind: 'sketch',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      sketch,
      visible: true,
    },
    {
      id: 'ex',
      name: 'Extrude',
      componentId: 'root',
      kind: 'extrude',
      sketchId: 'sk',
      profiles,
      distance,
      symmetric: false,
      reverse: false,
      result: { kind: 'newBody', bodyId: 'txt' },
    },
  ]
  doc.timeline = features
  return doc
}

function embossDoc(
  sketch: Sketch2D,
  body: Feature,
  bodyId: string,
  face: string,
  effect: 'emboss' | 'deboss',
  depth: number,
  plane: PlaneRef,
  profiles?: string[],
): OkcDocument {
  const doc = emptyDocument('Emboss')
  doc.components[0].bodies = [{ id: bodyId, name: 'Part', visible: true, colour: '#cccccc' }]
  doc.timeline = [
    body,
    {
      id: 'sk',
      name: 'Sketch',
      componentId: 'root',
      kind: 'sketch',
      plane,
      sketch,
      visible: true,
    },
    {
      id: 'em',
      name: 'Emboss',
      componentId: 'root',
      kind: 'emboss',
      sketchId: 'sk',
      profiles,
      face: { bodyId, kind: 'face', name: face },
      depth,
      effect,
    },
  ]
  return doc
}

function inkArea(entity: TextEntity, at: Vec2): number {
  return placedContours(entity, at).reduce(
    (sum, contour) => sum + signedArea(flattenContour(contour, 400)),
    0,
  )
}

const near = (a: number, b: number, relative: number) =>
  Math.abs(a - b) <= relative * Math.max(Math.abs(a), Math.abs(b))

export async function runTextTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Text: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }

  const font = testFont()
  const io = textOutline(font, 'IO')
  const cross = textOutline(font, 'X')
  const bowl = textOutline(font, 'D')

  await check('outlines', () => {
    add(
      'letters are measured so capitals are one unit tall',
      io.contours.length === 3 &&
        Math.abs(io.width - 1.4) < 1e-9 &&
        io.contours.every((contour) =>
          [contour.start, ...contour.segments].every(
            (point) => point[point.length - 1] >= -1e-9 && point[point.length - 1] <= 1 + 1e-9,
          ),
        ),
      JSON.stringify({ contours: io.contours.length, width: io.width }),
    )
    const round = parse(font.toArrayBuffer())
    const again = textOutline(round, 'D')
    const area = (outline: TextOutline) =>
      outline.contours.reduce(
        (sum, contour) => sum + Math.abs(signedArea(flattenContour(contour, 400))),
        0,
      )
    add(
      'a font file read back gives the same letter shape',
      near(area(again), area(bowl), 2e-3) && again.contours.length === 1,
      `${area(again).toFixed(5)} vs ${area(bowl).toFixed(5)}`,
    )
    const file = new Uint8Array(font.toArrayBuffer())
    const collection = new Uint8Array(16 + file.length)
    const view = new DataView(collection.buffer)
    ;[0x74, 0x74, 0x63, 0x66].forEach((byte, i) => view.setUint8(i, byte))
    view.setUint16(4, 1)
    view.setUint32(8, 1)
    view.setUint32(12, 16)
    collection.set(file, 16)
    const fileView = new DataView(file.buffer)
    const tables = fileView.getUint16(4)
    for (let i = 0; i < tables; i++) {
      const at = 16 + 12 + i * 16 + 8
      view.setUint32(at, view.getUint32(at) + 16)
    }
    const fromCollection = textOutline(parse(singleFace(collection.buffer)), 'D')
    add(
      'a font inside a .ttc collection can be read',
      near(area(fromCollection), area(bowl), 2e-3),
      `${area(fromCollection).toFixed(5)}`,
    )
  })

  await check('self-crossing letters', () => {
    const crossed = textOutline(font, 'S')
    const entity = textEntity('t9', 'S', crossed)
    const loops = placedContours(entity, [0, 0])
    add(
      'a letter drawn as one outline that crosses itself is cut into simple loops',
      crossed.contours.length === 1 &&
        loops.length === 2 &&
        loops.every((loop) => Math.abs(signedArea(flattenContour(loop, 32)) ** 2 - 20 ** 2) < 0.5),
      JSON.stringify({
        contours: crossed.contours.length,
        loops: loops.length,
        areas: loops.map((loop) => signedArea(flattenContour(loop, 32)).toFixed(3)),
      }),
    )
  })

  await check('profiles', () => {
    const entity = textEntity('t1', 'IO', io)
    const sketch = sketchWith([{ entity, at: [5, 5] }])
    const texts = cachedTextProfiles(sketch)
    const inside = textProfileAt(texts, [6, 10], 0.01)
    const counter = textProfileAt(texts, [5 + 4 + 4, 10], 0.01)
    add(
      'a text is one profile that is picked by clicking its letters',
      texts.length === 1 &&
        texts[0].key === textKey('t1') &&
        inside?.key === textKey('t1') &&
        counter === null &&
        Math.abs(texts[0].area - 76) < 1e-6,
      JSON.stringify({
        texts: texts.length,
        inside: inside?.key,
        counter: counter?.key,
        area: texts[0]?.area,
      }),
    )
  })

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const evaluate = (d: OkcDocument) => kernel.evaluate(d, [])
  const said = (result: EvaluateResult) =>
    result.errors.map((error) => `${error.severity}: ${error.message}`).join('; ') || 'clean'
  const volumeOf = (result: EvaluateResult) => {
    const instance = result.instances.find((candidate) => candidate.bodyId === 'txt')
    const mesh: BodyMesh | undefined = instance
      ? result.meshes.find((candidate) => candidate.key === instance.meshKey)
      : undefined
    return mesh?.volume ?? 0
  }

  try {
    await kernel.ready()

    await check('extrude text', async () => {
      const entity = textEntity('t1', 'IO', io)
      const result = await evaluate(textDoc(sketchWith([{ entity, at: [5, 5] }]), [textKey('t1')]))
      add(
        'text extrudes into letters with their holes',
        result.errors.length === 0 && Math.abs(volumeOf(result) - 76 * 2) < 0.01,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of 152`,
      )
      const curved = textEntity('t2', 'D', bowl)
      const expected = Math.abs(inkArea(curved, [0, 0])) * 3
      const round = await evaluate(
        textDoc(sketchWith([{ entity: curved, at: [0, 0] }]), undefined, 3),
      )
      add(
        'curved letters keep their true curves',
        round.errors.length === 0 && Math.abs(volumeOf(round) - expected) < 0.01,
        `${said(round)}; volume ${volumeOf(round).toFixed(4)} of ${expected.toFixed(4)}`,
      )
    })

    await check('self-crossing letters build', async () => {
      const entity = textEntity('t9', 'S', textOutline(font, 'S'))
      const result = await evaluate(textDoc(sketchWith([{ entity, at: [0, 0] }]), [textKey('t9')]))
      add(
        'a letter that crosses itself fills both of its loops',
        result.errors.length === 0 && Math.abs(volumeOf(result) - 40 * 2) < 0.02,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of 80`,
      )
    })

    await check('overlapping strokes', async () => {
      const entity = textEntity('t1', 'X', cross)
      const result = await evaluate(textDoc(sketchWith([{ entity, at: [0, 0] }]), [textKey('t1')]))
      add(
        'strokes that overlap inside a letter merge into one solid',
        result.errors.length === 0 && Math.abs(volumeOf(result) - 32 * 2) < 0.01,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of 64`,
      )
    })

    await check('text on a plate', async () => {
      const entity = textEntity('t1', 'IO', io)
      const sketch = sketchWith([{ entity, at: [5, 5] }], [0, 0, 30, 20])
      const plate = cachedRegions(sketch).regions.find((region) => region.solid)!
      const stencil = await evaluate(textDoc(sketch, [plate.key]))
      add(
        'picking only the plate around a text cuts the letters out of it',
        stencil.errors.length === 0 && Math.abs(volumeOf(stencil) - (600 - 76) * 2) < 0.01,
        `${said(stencil)}; volume ${volumeOf(stencil).toFixed(3)} of 1048`,
      )
      const both = await evaluate(textDoc(sketch, [plate.key, textKey('t1')]))
      add(
        'picking the plate and the text gives a whole plate',
        both.errors.length === 0 && Math.abs(volumeOf(both) - 600 * 2) < 0.01,
        `${said(both)}; volume ${volumeOf(both).toFixed(3)} of 1200`,
      )
      const whole = await evaluate(textDoc(sketch, undefined))
      add(
        'extruding the whole sketch keeps the plate whole',
        whole.errors.length === 0 && Math.abs(volumeOf(whole) - 600 * 2) < 0.01,
        `${said(whole)}; volume ${volumeOf(whole).toFixed(3)} of 1200`,
      )
      const hanging = textEntity('t3', 'I', textOutline(font, 'I'))
      const edge = sketchWith([{ entity: hanging, at: [29, 5] }], [0, 0, 30, 20])
      const edgePlate = cachedRegions(edge).regions.find((region) => region.solid)!
      const bitten = await evaluate(textDoc(edge, [edgePlate.key]))
      add(
        'a letter hanging over the edge of the plate bites only the part inside',
        bitten.errors.length === 0 && Math.abs(volumeOf(bitten) - (600 - 10) * 2) < 0.01,
        `${said(bitten)}; volume ${volumeOf(bitten).toFixed(3)} of 1180`,
      )
    })
    const block: Feature = {
      id: 'bx',
      name: 'Block',
      componentId: 'root',
      kind: 'box',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [0, 0],
      width: 40,
      depth: 20,
      height: 10,
      result: { kind: 'newBody', bodyId: 'part' },
    }
    const rod: Feature = {
      id: 'cy',
      name: 'Rod',
      componentId: 'root',
      kind: 'cylinder',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      centre: [0, 0],
      radius: 10,
      height: 30,
      result: { kind: 'newBody', bodyId: 'part' },
    }
    const partVolume = (result: EvaluateResult) => {
      const instance = result.instances.find((candidate) => candidate.bodyId === 'part')
      const mesh = instance
        ? result.meshes.find((candidate) => candidate.key === instance.meshKey)
        : undefined
      return mesh?.volume ?? 0
    }

    await check('emboss on a flat face', async () => {
      const entity = textEntity('t1', 'IO', io)
      const sketch = sketchWith([{ entity, at: [5, 5] }])
      const top: PlaneRef = { kind: 'named', name: 'XY', offset: 10 }
      const raised = await evaluate(embossDoc(sketch, block, 'part', 'bx:+z', 'emboss', 1, top))
      add(
        'text on the top of a block stands proud of it',
        raised.errors.length === 0 && Math.abs(partVolume(raised) - (8000 + 76)) < 0.02,
        `${said(raised)}; volume ${partVolume(raised).toFixed(3)} of 8076`,
      )
      const sunk = await evaluate(embossDoc(sketch, block, 'part', 'bx:+z', 'deboss', 1, top))
      add(
        'debossed text sinks into the block',
        sunk.errors.length === 0 && Math.abs(partVolume(sunk) - (8000 - 76)) < 0.02,
        `${said(sunk)}; volume ${partVolume(sunk).toFixed(3)} of 7924`,
      )
      const above = await evaluate(
        embossDoc(sketch, block, 'part', 'bx:+z', 'emboss', 1, {
          kind: 'named',
          name: 'XY',
          offset: 25,
        }),
      )
      add(
        'a sketch on a plane above the face embosses onto the face itself',
        above.errors.length === 0 && Math.abs(partVolume(above) - (8000 + 76)) < 0.02,
        `${said(above)}; volume ${partVolume(above).toFixed(3)} of 8076`,
      )
      const sideways = await evaluate(
        embossDoc(sketch, block, 'part', 'bx:+z', 'emboss', 1, {
          kind: 'named',
          name: 'XZ',
          offset: 0,
        }),
      )
      add(
        'a sketch at an angle to the face is refused',
        sideways.errors.some((error) => error.message.includes('not parallel')),
        said(sideways),
      )
    })

    await check('emboss on a round face', async () => {
      const bar = textEntity('t1', 'I', textOutline(font, 'I'))
      const sketch = sketchWith([{ entity: bar, at: [-5, 10] }])
      const side: PlaneRef = { kind: 'named', name: 'XZ', offset: 0 }
      const barrel = Math.PI * 100 * 30
      const raised = await evaluate(embossDoc(sketch, rod, 'part', 'cy:side', 'emboss', 1, side))
      add(
        'text on a round face wraps round it and stands proud',
        raised.errors.length === 0 && Math.abs(partVolume(raised) - (barrel + 21)) < 0.05,
        `${said(raised)}; volume ${partVolume(raised).toFixed(3)} of ${(barrel + 21).toFixed(3)}`,
      )
      const sunk = await evaluate(embossDoc(sketch, rod, 'part', 'cy:side', 'deboss', 1, side))
      add(
        'debossed text on a round face cuts a wrapped groove',
        sunk.errors.length === 0 && Math.abs(partVolume(sunk) - (barrel - 19)) < 0.05,
        `${said(sunk)}; volume ${partVolume(sunk).toFixed(3)} of ${(barrel - 19).toFixed(3)}`,
      )
      const pair = textEntity('t3', 'IO', io)
      const both = await evaluate(
        embossDoc(
          sketchWith([{ entity: pair, at: [-5, 10] }]),
          rod,
          'part',
          'cy:side',
          'emboss',
          1,
          side,
        ),
      )
      add(
        'several letters at once each wrap round the face',
        both.errors.length === 0 && Math.abs(partVolume(both) - (barrel + 79.8)) < 0.05,
        `${said(both)}; volume ${partVolume(both).toFixed(3)} of ${(barrel + 79.8).toFixed(3)}`,
      )
      const wide = textEntity(
        't2',
        'IIIIIIIIIIIIIIIIIIII',
        textOutline(font, 'IIIIIIIIIIIIIIIIIIII'),
      )
      const long = await evaluate(
        embossDoc(
          sketchWith([{ entity: wide, at: [-5, 10] }]),
          rod,
          'part',
          'cy:side',
          'emboss',
          1,
          side,
        ),
      )
      add(
        'text longer than the way round the face is refused',
        long.errors.some((error) => error.message.includes('longer than the way round')),
        said(long),
      )
      const flat = await evaluate(embossDoc(sketch, rod, 'part', 'cy:+z', 'emboss', 1, side))
      add(
        'embossing the end of the rod from a sketch beside it is refused',
        flat.errors.some((error) => error.message.includes('not parallel')),
        said(flat),
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
