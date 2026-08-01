import { useEffect, useRef, useState } from 'react'
import { newId, useStore, type Selection } from '../doc/store'
import type { ExtrudeFeature, OkcDocument } from '../doc/types'
import { getPart } from '../catalogue'
import { groupActions, showHeadings } from './menuGroups'

/**
 * Right-click menu for finished solids and placed parts.
 *
 * The feature tree already exposes all of this, but a beginner looking at a
 * plate on screen does not think "I should find the extrude step in the tree
 * and change its distance". They think "make this thicker". This menu is that
 * sentence.
 */
interface PromptField {
  label: string
  initial: number
  unit: string
}

export interface ObjectAction {
  id: string
  label: string
  /** Heading this sits under. Derived from the id, see objectGroupOf. */
  group?: string
  hint?: string
  prompt?: PromptField
  /** A second number, for the few things that genuinely need two. */
  prompt2?: PromptField
  danger?: boolean
  run: (value: number, value2?: number) => void
}


/**
 * Menu headings, keyed off the action id.
 *
 * Combining is matched by prefix because there is one entry per other body in
 * the document, and with a few bodies that section alone is longer than the
 * rest of the menu put together.
 */
const OBJECT_GROUPS: Array<[string, string[]]> = [
  ['Start a sketch', ['sketch-XY', 'sketch-XZ', 'sketch-YZ', 'sketch-offset', 'sketch-tilted']],
  ['Add a shape', ['add-box', 'add-cylinder', 'add-sphere', 'add-dome']],
  ['Draw on it', ['sketch-on-face', 'sketch-on-top', 'edit-sketch']],
  [
    'Change its shape',
    ['thickness', 'hollow', 'hollow-lid', 'round-picked', 'bevel-picked', 'round', 'bevel'],
  ],
  ['Cut into it', ['vent-hex', 'vent-round', 'vent-square', 'cut-ball', 'cut-box']],
  ['Move it', ['move', 'turn', 'flip']],
  ['Build around it', ['holes', 'standoffs', 'ports']],
  ['This part', ['hide', 'delete']],
]

export function objectGroupOf(id: string): string {
  if (id.startsWith('join-') || id.startsWith('cut-') || id.startsWith('overlap-')) {
    // Careful: "cut-ball" and "cut-box" are shapes, not other bodies.
    if (id !== 'cut-ball' && id !== 'cut-box') return 'Combine with another part'
  }
  for (const [group, ids] of OBJECT_GROUPS) {
    if (ids.includes(id)) return group
  }
  return 'Other'
}

/** The extrude that actually made this body, if there is one. */
function mainExtrude(doc: OkcDocument, bodyId: string): ExtrudeFeature | undefined {
  const body = doc.bodies.find((b) => b.id === bodyId)
  return body?.features.find((f): f is ExtrudeFeature => f.kind === 'extrude')
}

/** Where the user right-clicked, so "draw on this face" knows which face. */
export interface PickedFace {
  bodyId: string
  point: [number, number, number]
  normal: [number, number, number]
}

export function objectActions(
  selection: Selection,
  picked?: PickedFace | null,
): ObjectAction[] {
  const store = useStore.getState()
  const doc = store.doc
  const raw: ObjectAction[] = []
  const out = raw

  if (selection.kind === 'body' && selection.id) {
    const bodyId = selection.id
    const body = doc.bodies.find((b) => b.id === bodyId)
    if (!body) return raw.map((a) => ({ ...a, group: objectGroupOf(a.id) }))
    const extrude = mainExtrude(doc, bodyId)
    const sketchId = extrude?.sketchId ?? body.features.find((f) => f.kind === 'sketch')?.id

    // The headline action: draw directly on the face under the cursor. Without
    // this you can only ever sketch on the three base planes, which means you
    // cannot put a hole in the side of a box.
    if (picked && picked.bodyId === bodyId) {
      out.push({
        id: 'sketch-on-face',
        label: 'Draw on this face',
        hint: 'Start an outline right where you clicked',
        run: () =>
          store.startSketch(
            {
              kind: 'face',
              face: { bodyId, anchor: picked.point, normal: picked.normal },
              offset: 0,
            },
            bodyId,
          ),
      })
    }

    if (sketchId) {
      out.push({
        id: 'edit-sketch',
        label: 'Edit the shape this was drawn from',
        hint: 'Go back to the outline and change it',
        run: () => store.openSketch(bodyId, sketchId),
      })
    }
    if (extrude) {
      out.push({
        id: 'thickness',
        label: 'Change the thickness',
        prompt: { label: 'Thickness', initial: extrude.distance, unit: 'mm' },
        run: (value) => store.updateFeature(bodyId, extrude.id, { distance: value } as never),
      })
    }
    if (picked && picked.bodyId === bodyId) {
      const hollowOut = (thickness: number, withLid: boolean) => {
        const shellId = newId('shell')
        store.addFeature(bodyId, {
          id: shellId,
          kind: 'shell',
          name: 'Hollow out',
          thickness,
          openFaces: [{ bodyId, anchor: picked.point, normal: picked.normal }],
        })
        if (!withLid) return
        // The lid is its own body: you print it separately, and you want to be
        // able to hide it to see inside.
        const lidBody = store.addBody(`${body.name} lid`)
        store.addFeature(lidBody, {
          id: newId('lid'),
          kind: 'lid',
          name: 'Lid',
          sourceBodyId: bodyId,
          shellFeatureId: shellId,
          thickness,
        })
      }

      out.push({
        id: 'hollow',
        label: 'Hollow it out, opening this face',
        hint: 'Turns a solid block into a box with walls this thick',
        prompt: { label: 'Wall', initial: 2, unit: 'mm' },
        run: (thickness) => hollowOut(thickness, false),
      })
      out.push({
        id: 'hollow-lid',
        label: 'Hollow it out and make this side a lid',
        hint: 'Same, plus a separate cap you can print and fit afterwards',
        prompt: { label: 'Wall', initial: 2, unit: 'mm' },
        run: (thickness) => hollowOut(thickness, true),
      })
    }
    // Anything picked with shift takes priority over the blanket versions,
    // because "round these three edges" is nearly always what was meant when
    // the user went to the trouble of selecting them.
    const pickedEdges = store.subSelection.filter(
      (s) => s.bodyId === bodyId && s.kind === 'edge',
    )
    if (pickedEdges.length > 0) {
      const refs = pickedEdges.map((s) => ({
        bodyId,
        anchor: s.point,
        length: s.length ?? 0,
      }))
      const many = pickedEdges.length > 1
      out.push({
        id: 'round-picked',
        label: `Round ${many ? `these ${pickedEdges.length} edges` : 'this edge'}`,
        hint: 'Only the ones you selected',
        prompt: { label: 'Radius', initial: 2, unit: 'mm' },
        run: (radius) =>
          store.addFeature(bodyId, {
            id: newId('fillet'),
            kind: 'fillet',
            name: many ? `Round ${pickedEdges.length} edges` : 'Round an edge',
            radius,
            edges: refs,
          }),
      })
      out.push({
        id: 'bevel-picked',
        label: `Bevel ${many ? `these ${pickedEdges.length} edges` : 'this edge'}`,
        prompt: { label: 'Size', initial: 1, unit: 'mm' },
        run: (distance) =>
          store.addFeature(bodyId, {
            id: newId('chamfer'),
            kind: 'chamfer',
            name: many ? `Bevel ${pickedEdges.length} edges` : 'Bevel an edge',
            distance,
            edges: refs,
          }),
      })
    }

    if (picked && picked.bodyId === bodyId) {
      const ventOn = (shape: 'hex' | 'round' | 'square', label: string) => ({
        id: `vent-${shape}`,
        label,
        hint: 'A grid of holes across this face, with a solid border left round the edge',
        prompt: { label: 'Hole size', initial: shape === 'hex' ? 6 : 4, unit: 'mm' },
        prompt2: { label: 'Gap between', initial: 2, unit: 'mm' },
        run: (size: number, spacing?: number) =>
          store.addFeature(bodyId, {
            id: newId('vent'),
            kind: 'vent',
            name: 'Vent holes',
            plane: {
              kind: 'face',
              face: { bodyId, anchor: picked.point, normal: picked.normal },
              offset: 0,
            },
            shape,
            size,
            spacing: spacing ?? 2,
            margin: 3,
            depth: 'through',
          }),
      })
      out.push(ventOn('hex', 'Vent this face with hexagons'))
      out.push(ventOn('round', 'Vent this face with round holes'))
      out.push(ventOn('square', 'Vent this face with square holes'))
    }

    out.push({
      id: 'round',
      label: 'Round all the edges',
      hint: 'Softens every corner at once',
      prompt: { label: 'Radius', initial: 2, unit: 'mm' },
      run: (radius) =>
        store.addFeature(bodyId, {
          id: newId('fillet'),
          kind: 'fillet',
          name: 'Round edges',
          radius,
          edges: [],
        }),
    })
    out.push({
      id: 'bevel',
      label: 'Bevel all the edges',
      prompt: { label: 'Size', initial: 1, unit: 'mm' },
      run: (distance) =>
        store.addFeature(bodyId, {
          id: newId('chamfer'),
          kind: 'chamfer',
          name: 'Bevel edges',
          distance,
          edges: [],
        }),
    })
    out.push({
      id: 'sketch-on-top',
      label: 'Draw on top of this',
      hint: 'Start a new outline on the highest face',
      run: () => {
        const shape = store.shapes.find((s) => s.id === bodyId)
        store.startSketch(
          { kind: 'named', name: 'XY', offset: shape ? shape.bounds[5] : 0 },
          bodyId,
        )
      },
    })
    // One entry per other body rather than a picker: with the handful of bodies
    // a project this size has, naming them outright is faster to read and
    // impossible to get wrong.
    const others = doc.bodies.filter((other) => other.id !== bodyId)
    const positionOf = (id: string) => doc.bodies.findIndex((x) => x.id === id)
    for (const other of others) {
      const later = positionOf(other.id) > positionOf(bodyId)
      const note = later
        ? ` (will move "${other.name}" above this one first)`
        : ''
      const withOrdering = (op: 'add' | 'cut' | 'intersect') => () => {
        // Bodies build top to bottom, so the tool has to come first.
        if (later) store.moveBodyBefore(other.id, bodyId)
        store.addFeature(bodyId, {
          id: newId('combine'),
          kind: 'combine',
          name:
            op === 'add'
              ? `Join with ${other.name}`
              : op === 'cut'
                ? `Cut away ${other.name}`
                : `Overlap with ${other.name}`,
          otherBodyId: other.id,
          operation: op,
          keepOther: false,
        })
      }
      out.push({
        id: `join-${other.id}`,
        label: `Join with ${other.name}`,
        hint: `Fuses the two into one part${note}`,
        run: withOrdering('add'),
      })
      out.push({
        id: `cut-${other.id}`,
        label: `Cut ${other.name} away from this`,
        hint: `Uses it as a cookie cutter${note}`,
        run: withOrdering('cut'),
      })
      out.push({
        id: `overlap-${other.id}`,
        label: `Keep only where they overlap`,
        hint: `The part they share with ${other.name}${note}`,
        run: withOrdering('intersect'),
      })
    }

    // Simple shapes used as cutters. Quicker than sketching for the common
    // "knock a round hollow out of that" jobs.
    const topOf = () => {
      const built = store.shapes.find((x) => x.id === bodyId)
      return built ? built.bounds[5] : 0
    }
    out.push({
      id: 'cut-ball',
      label: 'Cut a ball-shaped hollow',
      hint: 'Scoops a sphere out of the part, centred where you clicked',
      prompt: { label: 'Diameter', initial: 20, unit: 'mm' },
      run: (diameter) =>
        store.addFeature(bodyId, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball hollow',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: picked ? [picked.point[0], picked.point[1]] : [0, 0],
          radius: diameter / 2,
          half: false,
          operation: 'cut',
        }),
    })
    out.push({
      id: 'cut-box',
      label: 'Cut a square hollow',
      prompt: { label: 'Across', initial: 20, unit: 'mm' },
      prompt2: { label: 'Deep', initial: 10, unit: 'mm' },
      run: (across, deep) =>
        store.addFeature(bodyId, {
          id: newId('box'),
          kind: 'box',
          name: 'Square hollow',
          plane: { kind: 'named', name: 'XY', offset: topOf() },
          origin: picked
            ? [picked.point[0] - across / 2, picked.point[1] - across / 2]
            : [-across / 2, -across / 2],
          width: across,
          depth: across,
          height: -(deep ?? 10),
          operation: 'cut',
        }),
    })

    out.push({
      id: 'hide',
      label: 'Hide it',
      run: () =>
        store.commit((d) => {
          const target = d.bodies.find((x) => x.id === bodyId)
          if (target) target.visible = false
        }),
    })
    out.push({
      id: 'delete',
      label: 'Delete this part',
      danger: true,
      run: () => store.removeBody(bodyId),
    })
    return out
  }

  if (selection.kind === 'none') {
    const planes: Array<['XY' | 'XZ' | 'YZ', string]> = [
      ['XY', 'the top plane'],
      ['XZ', 'the front plane'],
      ['YZ', 'the right plane'],
    ]
    for (const [name, label] of planes) {
      out.push({
        id: `sketch-${name}`,
        label: `Start a sketch on ${label}`,
        run: () => store.startSketch({ kind: 'named', name, offset: 0 }),
      })
    }
    out.push({
      id: 'sketch-offset',
      label: 'Start a sketch above the top plane',
      hint: 'A parallel plane floating at a set height',
      prompt: { label: 'Height', initial: 20, unit: 'mm' },
      run: (offset) => store.startSketch({ kind: 'named', name: 'XY', offset }),
    })
    out.push({
      id: 'add-box',
      label: 'Add a box',
      hint: 'A plain rectangular block, no sketching needed',
      prompt: { label: 'Across', initial: 40, unit: 'mm' },
      prompt2: { label: 'Tall', initial: 20, unit: 'mm' },
      run: (across, tall) => {
        const id = store.addBody('Box')
        store.addFeature(id, {
          id: newId('box'),
          kind: 'box',
          name: 'Box',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          origin: [-across / 2, -across / 2],
          width: across,
          depth: across,
          height: tall ?? 20,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-cylinder',
      label: 'Add a cylinder',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      prompt2: { label: 'Tall', initial: 20, unit: 'mm' },
      run: (diameter, tall) => {
        const id = store.addBody('Cylinder')
        store.addFeature(id, {
          id: newId('cyl'),
          kind: 'cylinder',
          name: 'Cylinder',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          height: tall ?? 20,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-sphere',
      label: 'Add a ball',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      run: (diameter) => {
        const id = store.addBody('Ball')
        store.addFeature(id, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Ball',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: false,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'add-dome',
      label: 'Add a dome',
      hint: 'Half a ball, flat side down',
      prompt: { label: 'Diameter', initial: 30, unit: 'mm' },
      run: (diameter) => {
        const id = store.addBody('Dome')
        store.addFeature(id, {
          id: newId('sphere'),
          kind: 'sphere',
          name: 'Dome',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          centre: [0, 0],
          radius: diameter / 2,
          half: true,
          operation: 'new',
        })
      },
    })
    out.push({
      id: 'sketch-tilted',
      label: 'Start a sketch on a tilted plane',
      hint: 'The top plane tipped over, for sloped faces and brackets',
      prompt: { label: 'Tilt', initial: 30, unit: 'deg' },
      run: (angle) =>
        store.startSketch({
          kind: 'angled',
          name: 'XY',
          tiltAxis: 'x',
          angle,
          offset: 0,
        }),
    })
    return raw.map((a) => ({ ...a, group: objectGroupOf(a.id) }))
  }

  if (selection.kind === 'placement' && selection.id) {
    const id = selection.id
    const placement = doc.placements.find((p) => p.id === id)
    if (!placement) return raw.map((a) => ({ ...a, group: objectGroupOf(a.id) }))
    const part = getPart(placement.partId)
    const targetBody = doc.bodies[0]?.id

    out.push({
      id: 'move',
      label: 'Move it',
      hint: 'Drag the arrows. Snaps to 1 mm',
      run: () => store.setGizmoMode('translate'),
    })
    out.push({
      id: 'turn',
      label: 'Turn it',
      hint: 'Drag the ring. Snaps to 15 degrees',
      run: () => store.setGizmoMode('rotate'),
    })

    const holes = part?.mountingHoles
    if (targetBody && holes?.length) {
      const drillZ = () => {
        const shape = store.shapes.find((s) => s.id === targetBody)
        return shape ? shape.bounds[5] : placement.position[2]
      }
      out.push({
        id: 'holes',
        label: 'Put its mounting holes in',
        hint: `${holes.length} holes, cut right through`,
        run: () =>
          store.addFeature(targetBody, {
            id: newId('hole'),
            kind: 'hole',
            name: `Holes for ${placement.name}`,
            plane: { kind: 'named', name: 'XY', offset: drillZ() },
            source: { kind: 'placement', placementId: id },
            style: 'counterbore',
            diameter: (holes[0].diameter ?? 3) + 0.2,
            depth: 'through',
            counterboreDiameter: (holes[0].diameter ?? 3) + 3,
            counterboreDepth: 2,
          }),
      })
      out.push({
        id: 'standoffs',
        label: 'Stand it off on pillars',
        prompt: { label: 'Height', initial: 6, unit: 'mm' },
        run: (height) =>
          store.addFeature(targetBody, {
            id: newId('standoff'),
            kind: 'standoff',
            name: `Standoffs for ${placement.name}`,
            plane: { kind: 'named', name: 'XY', offset: drillZ() },
            source: { kind: 'placement', placementId: id },
            height,
            outerDiameter: (holes[0].diameter ?? 3) + 3,
            boreDiameter: Math.max((holes[0].diameter ?? 3) - 0.6, 1.2),
            boreDepth: Math.max(height - 1, 2),
          }),
      })
    }
    if (targetBody && part?.connectors?.length) {
      out.push({
        id: 'ports',
        label: 'Cut its port openings',
        hint: part.connectors.map((c) => c.label).slice(0, 3).join(', '),
        run: () =>
          store.addFeature(targetBody, {
            id: newId('ports'),
            kind: 'portCutout',
            name: `Openings for ${placement.name}`,
            placementId: id,
            connectorIds: [],
            tolerance: 0.6,
          }),
      })
    }

    out.push({
      id: 'flip',
      label: placement.flipped ? 'Turn it right way up' : 'Flip it upside down',
      run: () => store.updatePlacement(id, { flipped: !placement.flipped }),
    })
    out.push({
      id: 'delete',
      label: 'Remove this part',
      danger: true,
      run: () => store.removePlacement(id),
    })
  }

  return raw.map((a) => ({ ...a, group: objectGroupOf(a.id) }))
}

export function ObjectMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: ObjectAction[]
  onClose: () => void
}) {
  const [pending, setPending] = useState<ObjectAction | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const secondRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', key)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const fire = (action: ObjectAction, value: number, value2?: number) => {
    action.run(value, value2)
    onClose()
  }

  /** Commit the pending action, reading whichever fields it asked for. */
  const commit = (first: HTMLInputElement) => {
    if (!pending) return
    const a = Number(first.value)
    const b = pending.prompt2 ? Number(secondRef.current?.value) : undefined
    if (!Number.isFinite(a)) return
    if (pending.prompt2 && !Number.isFinite(b as number)) return
    fire(pending, a, b)
  }

  return (
    <div
      className="sketch-menu"
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 260),
        top: Math.min(y, window.innerHeight - 300),
      }}
    >
      {pending ? (
        <>
          <div className="sketch-menu-prompt">
            <label>{pending.prompt!.label}</label>
            <input
              autoFocus
              type="number"
              step="0.5"
              defaultValue={pending.prompt!.initial}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(e.target as HTMLInputElement)
                if (e.key === 'Escape') setPending(null)
              }}
            />
            <span>{pending.prompt!.unit}</span>
          </div>
          {pending.prompt2 && (
            <div className="sketch-menu-prompt">
              <label>{pending.prompt2.label}</label>
              <input
                ref={secondRef}
                type="number"
                step="0.5"
                defaultValue={pending.prompt2.initial}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = ref.current?.querySelector('input')
                    if (first) commit(first as HTMLInputElement)
                  }
                  if (e.key === 'Escape') setPending(null)
                }}
              />
              <span>{pending.prompt2.unit}</span>
            </div>
          )}
        </>
      ) : actions.length === 0 ? (
        <div className="sketch-menu-empty">Right-click a part to change it.</div>
      ) : (
        groupActions(actions).map(([group, items]) => (
          <div key={group}>
            {showHeadings(actions) && <div className="menu-group">{group}</div>}
            {items.map((action) => (
              <button
                key={action.id}
                className={`sketch-menu-item ${action.danger ? 'danger' : ''}`}
                onClick={() => (action.prompt ? setPending(action) : fire(action, 0))}
              >
                <strong>{action.label}</strong>
                {action.hint && <span>{action.hint}</span>}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
