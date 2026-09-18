import * as Comlink from 'comlink'
import { partProblems } from '../catalogue'
import { kicadPart, readKicadBoard } from '../catalogue/kicad'
import type { Feature, OkcDocument } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

const BOARD = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (title_block (title "Test Board"))
  (gr_line (start 103 50) (end 157 50) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_arc (start 157 50) (mid 159.1213 50.8787) (end 160 53) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_line (start 160 53) (end 160 87) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_arc (start 160 87) (mid 159.1213 89.1213) (end 157 90) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_line (start 103 90) (end 157 90) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_arc (start 103 90) (mid 100.8787 89.1213) (end 100 87) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_line (start 100 53) (end 100 87) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_arc (start 100 53) (mid 100.8787 50.8787) (end 103 50) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_text "not an edge" (at 120 40) (layer "F.SilkS"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 103.5 53.5)
    (property "Reference" "H1" (at 0 -4 0) (layer "F.SilkS"))
    (fp_circle (center 0 0) (end 3.45 0) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 156.5 53.5)
    (property "Reference" "H2" (at 0 -4 0) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 103.5 86.5)
    (property "Reference" "H3" (at 0 -4 0) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 156.5 86.5)
    (property "Reference" "H4" (at 0 -4 0) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal" (layer "F.Cu") (at 130 89)
    (property "Reference" "J1" (at 0 -5 0) (layer "F.SilkS"))
    (property "Value" "USB_C_Receptacle" (at 0 5 0) (layer "F.Fab"))
    (fp_rect (start -4.8 -4) (end 4.8 2.2) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))
    (pad "A1" smd rect (at -3.25 -3) (size 0.6 1.1) (layers "F.Cu" "F.Paste" "F.Mask")))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (layer "F.Cu") (at 110 60 90)
    (property "Reference" "J2" (at 0 -2.33 90) (layer "F.SilkS"))
    (property "Value" "Conn_01x04" (at 0 9.95 90) (layer "F.Fab"))
    (fp_line (start -1.8 -1.8) (end 1.8 -1.8) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))
    (fp_line (start 1.8 -1.8) (end 1.8 9.4) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))
    (fp_line (start 1.8 9.4) (end -1.8 9.4) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))
    (fp_line (start -1.8 9.4) (end -1.8 -1.8) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))
    (pad "1" thru_hole rect (at 0 0 90) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask")))
  (footprint "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" (layer "F.Cu") (at 140 70)
    (property "Reference" "U1" (at 0 -3.4 0) (layer "F.SilkS"))
    (property "Value" "NE555" (at 0 3.4 0) (layer "F.Fab"))
    (fp_rect (start -3.7 -2.7) (end 3.7 2.7) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd")))
  (footprint "Capacitor_SMD:C_0805_2012Metric" (layer "B.Cu") (at 120 75)
    (property "Reference" "C1" (at 0 1.65 0) (layer "B.SilkS"))
    (fp_rect (start -1.7 -1) (end 1.7 1) (stroke (width 0.05) (type solid)) (fill none) (layer "B.CrtYd")))
  (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu") (at 125 65)
    (property "Reference" "R1" (at 0 -1.43 0) (layer "F.SilkS"))
    (pad "1" smd roundrect (at -0.8 0) (size 0.8 0.95) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd roundrect (at 0.8 0) (size 0.8 0.95) (layers "F.Cu" "F.Paste" "F.Mask")))
)`

const OLD_BOARD = `(kicad_pcb (version 20171130) (host pcbnew 5.1.9)
  (general (thickness 1.2))
  (gr_line (start 0 0) (end 50 0) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 50 0) (end 50 30) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 50 30) (end 0 30) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 0 30) (end 0 0) (layer Edge.Cuts) (width 0.05))
  (module Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical (layer F.Cu) (tedit 5C28146C) (tstamp 5D1)
    (at 10 28)
    (fp_text reference J3 (at 0 -2) (layer F.SilkS))
    (fp_text value Battery (at 0 3) (layer F.Fab))
    (fp_line (start -2.95 -2.85) (end 5.45 -2.85) (layer F.CrtYd) (width 0.05))
    (fp_line (start 5.45 -2.85) (end 5.45 3.9) (layer F.CrtYd) (width 0.05))
    (fp_line (start 5.45 3.9) (end -2.95 3.9) (layer F.CrtYd) (width 0.05))
    (fp_line (start -2.95 3.9) (end -2.95 -2.85) (layer F.CrtYd) (width 0.05))))
`

export async function runKicadTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `KiCad: ${name}`, pass, detail })
  const near = (a: number | undefined, b: number, within = 0.01) =>
    a !== undefined && Math.abs(a - b) < within
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }

  const board = readKicadBoard(BOARD, 'test.kicad_pcb')
  const find = (ref: string) => board.footprints.find((footprint) => footprint.ref === ref)

  await check('outline', () => {
    const outline = board.outline
    add(
      'a rounded edge from lines and arcs becomes a 60 x 40 board with 3 mm corners',
      outline.shape === 'rect' &&
        near(outline.w, 60) &&
        near(outline.h, 40) &&
        near(outline.cornerRadius, 3, 0.02) &&
        board.thickness === 1.6 &&
        board.name === 'Test Board',
      JSON.stringify({ outline, thickness: board.thickness, name: board.name }),
    )
  })

  await check('holes', () => {
    const spots = board.holes.map((hole) => `${hole.x},${hole.y},${hole.diameter},${hole.screw}`)
    add(
      'mounting holes come across measured from the bottom-left corner',
      board.holes.length === 4 &&
        spots.includes('3.5,36.5,3.2,M3') &&
        spots.includes('56.5,3.5,3.2,M3'),
      spots.join(' '),
    )
  })

  await check('footprints', () => {
    const j1 = find('J1')
    const j2 = find('J2')
    const c1 = find('C1')
    const r1 = find('R1')
    add(
      'every other footprint becomes a block with a guessed height',
      board.footprints.length === 5 &&
        j1?.height === 3.3 &&
        find('U1')?.height === 1.75 &&
        j2?.height === 8.5 &&
        c1?.height === 0.6 &&
        c1.back &&
        r1?.height === 0.5,
      board.footprints.map((f) => `${f.ref}:${f.height}${f.back ? 'B' : ''}`).join(' '),
    )
    add(
      'a rotated footprint lands where KiCad draws it',
      !!j2 &&
        near(j2.box[0], 8.2) &&
        near(j2.box[2], 19.4) &&
        near(j2.box[1], 28.2) &&
        near(j2.box[3], 31.8),
      JSON.stringify(j2?.box),
    )
    add(
      'a footprint without a courtyard is boxed by its pads',
      !!r1 && r1.box[2] - r1.box[0] > 2 && r1.box[3] - r1.box[1] > 0.6 && !r1.edge,
      JSON.stringify(r1?.box),
    )
    add(
      'a connector hanging over the edge is marked',
      !!j1?.edge && !j2?.edge,
      `${j1?.edge} ${j2?.edge}`,
    )
  })

  await check('part', () => {
    const part = kicadPart(
      board,
      { name: 'Test Board', category: 'mcu', connectors: new Set(['J1']), heights: { U1: 2 } },
      'test-board',
    )
    const usb = part.connectors?.[0]
    const bumps = part.geometry.kind === 'board' ? (part.geometry.bumps ?? []) : []
    const chip = bumps.find((bump) => bump.label?.startsWith('U1'))
    const cap = bumps.find((bump) => bump.label?.startsWith('C1'))
    add(
      'the ticked connector faces the edge it hangs over',
      part.connectors?.length === 1 &&
        usb?.side === '-y' &&
        near(usb.x, 30) &&
        usb.y === 0 &&
        near(usb.protrusion, 1.2) &&
        near(usb.width, 9.6) &&
        usb.z === 1.6 &&
        usb.height === 3.3,
      JSON.stringify(usb),
    )
    add(
      'typed heights win, and parts underneath hang below the board',
      chip?.height === 2 && cap?.z === -0.6 && cap.height === 0.6,
      JSON.stringify({ chip, cap }),
    )
    const problems = partProblems(part)
    add(
      'the part passes the catalogue checks',
      problems.length === 0,
      problems.join('; ') || 'clean',
    )
  })

  await check('kicad 5', () => {
    const old = readKicadBoard(OLD_BOARD, 'old.kicad_pcb')
    const jst = old.footprints[0]
    add(
      'a KiCad 5 file with module and fp_text reads the same way',
      old.outline.shape === 'rect' &&
        old.outline.w === 50 &&
        old.thickness === 1.2 &&
        old.name === 'old' &&
        jst?.ref === 'J3' &&
        jst.value === 'Battery' &&
        jst.height === 7 &&
        jst.edge,
      JSON.stringify({ outline: old.outline, jst }),
    )
  })

  await check('not a board', () => {
    let message = ''
    try {
      readKicadBoard('(kicad_sch (version 1))')
    } catch (error) {
      message = (error as Error).message
    }
    add('a schematic is refused', message.includes('not a KiCad board'), message)
  })

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const said = (result: EvaluateResult) =>
    result.errors.map((error) => `${error.severity}: ${error.message}`).join('; ') || 'clean'
  const meshOf = (result: EvaluateResult, bodyId: string) => {
    const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
    return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
  }
  try {
    await kernel.ready()
    await check('enclosure round an import', async () => {
      const part = kicadPart(
        board,
        { name: 'Test Board', category: 'mcu', connectors: new Set(['J1']), heights: {} },
        'test-board',
      )
      const doc = (ports: string[]): OkcDocument => {
        const next = emptyDocument('Imported')
        next.customParts = [part]
        next.components[0].bodies = [
          { id: 'box', name: 'Box', visible: true, colour: '#cccccc' },
          { id: 'lid', name: 'Lid', visible: true, colour: '#cccccc' },
        ]
        next.components.push({
          id: 'board-part',
          name: 'Test Board',
          source: { kind: 'catalogue', partId: 'test-board' },
          bodies: [],
        })
        next.occurrences.push({
          id: 'board',
          parentComponentId: next.rootComponentId,
          componentId: 'board-part',
          name: 'Test Board',
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 6, 1],
          visible: true,
          grounded: true,
        })
        next.timeline = [
          {
            id: 'en',
            name: 'Enclosure',
            componentId: 'root',
            kind: 'enclosure',
            contextPath: [],
            mounts: [{ occurrencePath: ['board'], kind: 'standoffs', connectorIds: ports }],
            clearance: 2,
            under: 4,
            wall: 2,
            floor: 2,
            lid: 'screws',
            lidThickness: 2,
            gap: 0.2,
            screw: 3,
            tolerance: 0.6,
            bodyId: 'box',
            lidBodyId: 'lid',
          } as Feature,
        ]
        return next
      }
      const closed = await kernel.evaluate(doc([]), [])
      const opened = await kernel.evaluate(doc(['j1']), [])
      const plain = meshOf(closed, 'box')
      const ported = meshOf(opened, 'box')
      add(
        'an imported board gets an enclosure with its USB-C opening',
        closed.errors.length === 0 &&
          opened.errors.length === 0 &&
          !!plain &&
          !!ported &&
          ported.volume < plain.volume - 20,
        `${said(opened)}; ${ported?.volume.toFixed(0)} against ${plain?.volume.toFixed(0)}`,
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
