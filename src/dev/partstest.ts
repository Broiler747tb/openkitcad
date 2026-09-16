import {
  CATALOGUE,
  catalogueEntries,
  draftToPart,
  dropPlacement,
  editedPart,
  FAMILIES,
  getPart,
  groupedEntries,
  holeSummary,
  partBounds,
  partProblems,
  partToDraft,
  readPartFile,
  searchEntries,
  surfaceMatrix,
  uniquePartId,
  type CataloguePart,
} from '../catalogue'
import type { Vec3 } from '../core/math'
import { useStore } from '../doc/store'
import { emptyDocument, type Matrix4 } from '../doc/types'
import {
  identityMatrix,
  multiplyMatrices,
  rotationMatrix,
  transformDirection,
  transformPoint,
  translationMatrix,
} from '../doc/model'
import { poseOf, withPose } from '../doc/placement'
import { RECENT_LIMIT, useShelf } from '../ui/parts/shelf'
import { renderPart } from '../ui/parts/render'
import { lookPrototype } from '../viewport/partLook'
import type { TestResult } from './selftest'

export function runPartsTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail = '') =>
    results.push({ name: `Parts: ${name}`, pass, detail: detail || (pass ? 'passed' : 'failed') })
  const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
    a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < eps)
  const show = (values: readonly number[]) =>
    `[${values.map((n) => Number(n.toFixed(4))).join(', ')}]`
  const part = (id: string) => {
    const found = getPart(id)
    if (!found) throw new Error(`missing part ${id}`)
    return found
  }

  const unpopular = CATALOGUE.filter(
    (p) => !Number.isInteger(p.popularity) || p.popularity! < 1 || p.popularity! > 100,
  )
  check(
    'every shipped part has a popularity from 1 to 100',
    !unpopular.length,
    unpopular.map((p) => p.id).join(', ') || `${CATALOGUE.length} parts`,
  )
  const order = CATALOGUE.every(
    (p, i) => i === 0 || (CATALOGUE[i - 1].popularity ?? 0) >= (p.popularity ?? 0),
  )
  check(
    'the catalogue is sorted most popular first',
    order,
    CATALOGUE.slice(0, 3)
      .map((p) => p.id)
      .join(', '),
  )

  const invalid = CATALOGUE.flatMap((p) => partProblems(p).map((problem) => `${p.id}: ${problem}`))
  check(
    'every shipped part passes the part file check',
    !invalid.length,
    invalid.slice(0, 3).join(' | ') || 'ok',
  )

  const familyProblems: string[] = []
  for (const p of CATALOGUE) {
    if (!p.family) continue
    const family = FAMILIES.get(p.family)
    if (!family) familyProblems.push(`${p.id} names unknown family ${p.family}`)
    else if (family.category !== p.category)
      familyProblems.push(`${p.id} is ${p.category} but ${family.id} is ${family.category}`)
    if (!p.variant?.trim()) familyProblems.push(`${p.id} has no version label`)
  }
  for (const family of FAMILIES.values()) {
    const members = CATALOGUE.filter((p) => p.family === family.id)
    if (members.length < 2) familyProblems.push(`${family.id} has ${members.length} parts`)
    const labels = new Set(members.map((p) => p.variant))
    if (labels.size !== members.length) familyProblems.push(`${family.id} repeats a version label`)
  }
  check(
    'families are known, share a category, and have at least two labelled versions',
    !familyProblems.length,
    familyProblems.slice(0, 3).join(' | ') || `${FAMILIES.size} families`,
  )

  const top = (query: string) => searchEntries(CATALOGUE, query)[0]
  const topName = (query: string) => {
    const entry = top(query)
    return entry ? `${entry.kind}:${entry.id}` : 'nothing'
  }
  check(
    '"rpi" finds a Raspberry Pi first',
    /raspberry/.test(top('rpi')?.name.toLowerCase() ?? ''),
    topName('rpi'),
  )
  const findsUsbC = (query: string) => {
    const entry = top(query)
    return entry?.kind === 'family'
      ? entry.parts.some((p) => p.id === 'port-usb-c')
      : entry?.id === 'port-usb-c'
  }
  check('"usbc" finds the USB-C sockets first', findsUsbC('usbc'), topName('usbc'))
  check('"type-c" finds the USB-C sockets first', findsUsbC('type-c'), topName('type-c'))
  check(
    'a typo still finds the part: "raspbery pi 4"',
    top('raspbery pi 4')?.id === 'raspberry-pi-4b',
    topName('raspbery pi 4'),
  )
  check(
    '"m3x10" finds the M3 x 10 screw first',
    top('m3x10')?.id === 'screw-m3-socket-10',
    topName('m3x10'),
  )
  const oled = searchEntries(CATALOGUE, 'oled').find((entry) => entry.id === 'oled-display')
  check(
    'versions of one part come back as one family row',
    oled?.kind === 'family' && oled.parts.length >= 3,
    oled ? `${oled.kind} with ${oled.kind === 'family' ? oled.parts.length : 1}` : 'no oled family',
  )
  check('nonsense finds nothing', searchEntries(CATALOGUE, 'zzqx flux capacitor').length === 0)
  const all = catalogueEntries(CATALOGUE)
  check(
    'browsing collapses families and keeps popularity order',
    all.length < CATALOGUE.length &&
      all.every((e, i) => i === 0 || all[i - 1].popularity >= e.popularity),
    `${all.length} rows for ${CATALOGUE.length} parts`,
  )
  const official = searchEntries(CATALOGUE, '', { official: true })
  const approximateLeaks = official.some((entry) =>
    entry.kind === 'part'
      ? entry.part.confidence === 'approximate'
      : entry.parts.some((p) => p.confidence === 'approximate'),
  )
  check('the verified sizes filter hides approximate parts', !approximateLeaks)
  const holed = searchEntries(CATALOGUE, '', { mountingHoles: true })
  check(
    'the mounting holes filter keeps only parts with holes',
    holed.every((entry) =>
      entry.kind === 'part'
        ? !!entry.part.mountingHoles?.length
        : entry.parts.every((p) => !!p.mountingHoles?.length),
    ),
  )
  const grouped = groupedEntries(CATALOGUE)
  check(
    'browsing by type covers every part once',
    grouped.reduce((sum, group) => sum + group.count, 0) === CATALOGUE.length,
    grouped.map((g) => `${g.category} ${g.count}`).join(', '),
  )

  const lookFailures: string[] = []
  for (const shipped of CATALOGUE) {
    try {
      const look = lookPrototype(shipped)
      const [x0, y0, z0, x1, y1, z1] = partBounds(shipped)
      const { min, max } = look.box
      const slack = 4
      const inside =
        min.x >= x0 - slack &&
        min.y >= y0 - slack &&
        min.z >= z0 - slack &&
        max.x <= x1 + slack &&
        max.y <= y1 + slack &&
        max.z <= z1 + slack
      const covers = max.x - min.x >= (x1 - x0) * 0.5 && max.y - min.y >= (y1 - y0) * 0.5
      if (!look.meshes.length) lookFailures.push(`${shipped.id} draws nothing`)
      else if (!inside || !covers)
        lookFailures.push(
          `${shipped.id} look ${[min.x, min.y, min.z, max.x, max.y, max.z].map((n) => n.toFixed(1)).join(',')} vs ${[x0, y0, z0, x1, y1, z1].join(',')}`,
        )
    } catch (error) {
      lookFailures.push(`${shipped.id} threw ${(error as Error).message}`)
    }
  }
  check(
    'every shipped part has a look that fills its measured size and stays inside it',
    !lookFailures.length,
    lookFailures.slice(0, 3).join(' | ') || `${CATALOGUE.length} looks`,
  )
  const picture = renderPart(part('arduino-uno-r3'), 96, 72)
  let drawn = 0
  if (picture) {
    const probe = document.createElement('canvas')
    probe.width = 96
    probe.height = 72
    const context = probe.getContext('2d')
    context?.drawImage(picture, 0, 0)
    const pixels = context?.getImageData(0, 0, 96, 72).data ?? new Uint8ClampedArray()
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) drawn++
  }
  check(
    'a part picture renders with the part in it',
    drawn > 96 * 72 * 0.15,
    `${drawn} of ${96 * 72} pixels drawn`,
  )
  const withLook: CataloguePart = {
    ...part('raspberry-pi-4b'),
    look: {
      components: [
        { kind: 'port', port: 'usb-c', x: 11.2, y: -1, facing: '-y' },
        { kind: 'header', x: 8, y: 50, rows: 2, cols: 20, style: 'female' },
        { kind: 'chip', x: 23, y: 24, w: 15, h: 15, legs: 'quad' },
        { kind: 'jst', x: 40, y: 10, pins: 3, facing: '+z' },
      ],
    },
  }
  check(
    'a hand-written look passes the part file check',
    partProblems(withLook).length === 0,
    partProblems(withLook).join(' | ') || 'ok',
  )
  check(
    'a look with a mistake is refused with a reason',
    partProblems({
      ...withLook,
      look: { components: [{ kind: 'port', port: 'usb-z', x: 1, y: 1 }] },
    }).some((p) => /port/.test(p)),
  )

  const pi = part('raspberry-pi-4b')
  check(
    'a Pi 4 hole pattern reads as 58 × 49 mm',
    holeSummary(pi, 'mm') === '4 holes for M2.5, 58 × 49 mm apart',
    holeSummary(pi, 'mm') ?? 'none',
  )

  const [bx0, by0, bz0, bx1, by1] = partBounds(pi)
  const centre: Vec3 = [(bx0 + bx1) / 2, (by0 + by1) / 2, bz0]
  const onTop = surfaceMatrix(pi, [10, 20, 5], [0, 0, 1])
  check(
    'a board dropped on a top face sits on it, centred where it was dropped',
    near(transformPoint(onTop, centre), [10, 20, 5]) &&
      near(transformDirection(onTop, [0, 0, 1]), [0, 0, 1]),
    show(transformPoint(onTop, centre)),
  )
  const onWall = surfaceMatrix(pi, [0, 30, 40], [0, 1, 0])
  const wallX = transformDirection(onWall, [1, 0, 0])
  const wallY = transformDirection(onWall, [0, 1, 0])
  const wallZ = transformDirection(onWall, [0, 0, 1])
  const handed = near(
    [
      wallX[1] * wallY[2] - wallX[2] * wallY[1],
      wallX[2] * wallY[0] - wallX[0] * wallY[2],
      wallX[0] * wallY[1] - wallX[1] * wallY[0],
    ],
    wallZ,
  )
  check(
    'a board dropped on a wall faces out of it with its top edge up',
    near(wallZ, [0, 1, 0]) &&
      near(wallY, [0, 0, 1]) &&
      handed &&
      near(transformPoint(onWall, centre), [0, 30, 40]),
    `x ${show(wallX)} y ${show(wallY)} z ${show(wallZ)}`,
  )
  const usbc = part('port-usb-c')
  const g = usbc.geometry
  if (g.kind === 'connector') {
    const port = surfaceMatrix(usbc, [-5, 12, 8], [-1, 0, 0])
    check(
      'a port dropped on a wall points out of it with its opening on the face',
      near(transformDirection(port, [0, 1, 0]), [-1, 0, 0]) &&
        near(transformDirection(port, [0, 0, 1]), [0, 0, 1]) &&
        near(transformPoint(port, [g.bodyWidth / 2, g.bodyDepth, g.bodyHeight / 2]), [-5, 12, 8]) &&
        transformPoint(port, [g.bodyWidth / 2, 0, g.bodyHeight / 2])[0] > -5,
      show(transformPoint(port, [g.bodyWidth / 2, 0, g.bodyHeight / 2])),
    )
  }
  const screw = part('screw-m3-socket-10')
  const sg = screw.geometry
  if (sg.kind === 'screw') {
    const r = sg.headDiameter / 2
    const placed = surfaceMatrix(screw, [0, 0, 3], [0, 0, 1])
    check(
      'a screw dropped on a face has its head on the face and its shank in the part',
      near(transformPoint(placed, [r, r, sg.length]), [0, 0, 3]) &&
        transformPoint(placed, [r, r, 0])[2] < 3,
      show(transformPoint(placed, [r, r, 0])),
    )
  }
  const motor = part('nema-17-stepper')
  const mg = motor.geometry
  if (mg.kind === 'motor') {
    const placed = surfaceMatrix(motor, [0, 0, 6], [0, 0, 1])
    check(
      'a stepper dropped on a plate hangs off it with the shaft through the plate',
      transformPoint(placed, [mg.frame / 2, mg.frame / 2, 0])[2] > 6 &&
        transformPoint(placed, [mg.frame / 2, mg.frame / 2, mg.bodyLength + 5])[2] < 6,
      show(transformPoint(placed, [mg.frame / 2, mg.frame / 2, 0])),
    )
  }
  const ground = dropPlacement(pi, { point: [10.4, 19.6, 0] }, identityMatrix())
  check(
    'dropping on empty space lands on the ground, snapped to whole millimetres',
    near(transformPoint(ground, centre), [10, 20, 0]) &&
      near(transformDirection(ground, [0, 0, 1]), [0, 0, 1]),
    show(transformPoint(ground, centre)),
  )
  const parent = multiplyMatrices(translationMatrix([100, 0, 0]), rotationMatrix('z', 90))
  const nested = dropPlacement(pi, { point: [100, 5, 7], normal: [0, 0, 1] }, parent)
  check(
    'inside a moved component the drop still lands where it was dropped',
    near(transformPoint(multiplyMatrices(parent, nested), centre), [100, 5, 7]),
    show(transformPoint(multiplyMatrices(parent, nested), centre)),
  )

  const wall = surfaceMatrix(pi, [0, 30, 40], [0, 1, 0]) as Matrix4
  const moved = withPose(wall, { position: [1, 2, 3] })
  check(
    'typing a position keeps a wall-mounted part on the wall',
    near(moved.slice(0, 12), wall.slice(0, 12)) && near(moved.slice(12, 15), [1, 2, 3]),
    show(moved.slice(8, 11)),
  )
  const turned = withPose(wall, { turn: poseOf(wall).turn + 90 })
  check(
    'turning a wall-mounted part spins it about Z without laying it flat',
    Math.abs(transformDirection(turned, [0, 0, 1])[2]) < 1e-9 &&
      near(transformDirection(turned, [0, 0, 1]), [-1, 0, 0]),
    show(transformDirection(turned, [0, 0, 1])),
  )

  const draft = partToDraft(pi)
  const rebuilt = draft ? editedPart(pi, draft) : undefined
  check(
    'editing a board keeps everything the form does not show',
    !!rebuilt &&
      JSON.stringify(rebuilt.geometry) === JSON.stringify(pi.geometry) &&
      JSON.stringify(rebuilt.mountingHoles) === JSON.stringify(pi.mountingHoles) &&
      JSON.stringify(rebuilt.connectors) === JSON.stringify(pi.connectors) &&
      rebuilt.id === pi.id &&
      rebuilt.popularity === pi.popularity,
  )
  check('only rectangular boards open in the part form', partToDraft(screw) === null)
  check(
    'a copy gets a fresh id',
    uniquePartId('raspberry-pi-4b', new Set(['raspberry-pi-4b', 'raspberry-pi-4b-2'])) ===
      'raspberry-pi-4b-3',
  )
  const made = draftToPart({ ...draft!, name: 'Test board' })
  const file = readPartFile(JSON.stringify([made, { id: 'Bad Id', name: 'Broken' }]))
  check(
    'importing a file keeps good parts and explains bad ones',
    file.parts.length === 1 && file.problems.length === 1 && /Broken/.test(file.problems[0]),
    file.problems.join(' | '),
  )
  check('a file that is not JSON is refused', readPartFile('{nope').problems.length === 1)

  const shelf = useShelf.getState()
  const savedShelf = { favourites: shelf.favourites, recent: shelf.recent }
  try {
    useShelf.getState().replace([], [])
    useShelf.getState().toggleFavourite('servo-sg90')
    const starred = useShelf.getState().favourites.includes('servo-sg90')
    useShelf.getState().toggleFavourite('servo-sg90')
    check('a star adds and removes a favourite', starred && !useShelf.getState().favourites.length)
    for (const p of CATALOGUE.slice(0, RECENT_LIMIT + 2)) useShelf.getState().noteUsed(p.id)
    useShelf.getState().noteUsed(CATALOGUE[3].id)
    const recent = useShelf.getState().recent
    check(
      'recently used keeps the latest first, without repeats, up to the limit',
      recent.length === RECENT_LIMIT &&
        recent[0] === CATALOGUE[3].id &&
        new Set(recent).size === recent.length,
      recent.slice(0, 3).join(', '),
    )
  } finally {
    useShelf.getState().replace(savedShelf.favourites, savedShelf.recent)
  }

  const saved = useStore.getState()
  try {
    const doc = emptyDocument()
    useStore.setState({
      rebuild: () => {},
      doc,
      past: [],
      future: [],
      selection: { kind: 'none' },
      activeSketch: null,
      activeComponentId: doc.rootComponentId,
      subSelection: [],
      sketchSelection: [],
      meshes: new Map(),
      instances: [],
    })
    const transform = surfaceMatrix(pi, [0, 30, 40], [0, 1, 0])
    const occurrenceId = useStore.getState().insertCatalogue('display-oled-ssd1306-096', transform)
    const inserted = useStore.getState().doc.occurrences.find((o) => o.id === occurrenceId)
    check(
      'a dropped part is inserted with the full placement, not just a position',
      !!inserted && near(inserted.transform, transform),
    )
    const componentId = inserted!.componentId
    useStore.getState().swapCataloguePart(componentId, 'display-oled-sh1106-130')
    const after = useStore.getState().doc
    const component = after.components.find((c) => c.id === componentId)
    const occurrence = after.occurrences.find((o) => o.id === occurrenceId)
    const next = getPart('display-oled-sh1106-130') as CataloguePart
    check(
      'swapping the version keeps the placement and renames the part',
      component?.source.kind === 'catalogue' &&
        component.source.partId === next.id &&
        component.name === next.name &&
        occurrence?.name === next.name &&
        near(occurrence.transform, transform),
      `${component?.name} / ${occurrence?.name}`,
    )
  } finally {
    useStore.setState(saved)
  }
  return results
}
