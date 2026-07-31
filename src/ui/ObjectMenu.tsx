import { useEffect, useRef, useState } from 'react'
import { newId, useStore, type Selection } from '../doc/store'
import type { ExtrudeFeature, OkcDocument } from '../doc/types'
import { getPart } from '../catalogue'

/**
 * Right-click menu for finished solids and placed parts.
 *
 * The feature tree already exposes all of this, but a beginner looking at a
 * plate on screen does not think "I should find the extrude step in the tree
 * and change its distance". They think "make this thicker". This menu is that
 * sentence.
 */
export interface ObjectAction {
  id: string
  label: string
  hint?: string
  prompt?: { label: string; initial: number; unit: string }
  danger?: boolean
  run: (value: number) => void
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
  const out: ObjectAction[] = []

  if (selection.kind === 'body' && selection.id) {
    const bodyId = selection.id
    const body = doc.bodies.find((b) => b.id === bodyId)
    if (!body) return out
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

  if (selection.kind === 'placement' && selection.id) {
    const id = selection.id
    const placement = doc.placements.find((p) => p.id === id)
    if (!placement) return out
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

  return out
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

  const fire = (action: ObjectAction, value: number) => {
    action.run(value)
    onClose()
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
        <div className="sketch-menu-prompt">
          <label>{pending.prompt!.label}</label>
          <input
            autoFocus
            type="number"
            step="0.5"
            defaultValue={pending.prompt!.initial}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = Number((e.target as HTMLInputElement).value)
                if (Number.isFinite(value)) fire(pending, value)
              }
              if (e.key === 'Escape') setPending(null)
            }}
          />
          <span>{pending.prompt!.unit}</span>
        </div>
      ) : actions.length === 0 ? (
        <div className="sketch-menu-empty">Right-click a part to change it.</div>
      ) : (
        actions.map((action) => (
          <button
            key={action.id}
            className={`sketch-menu-item ${action.danger ? 'danger' : ''}`}
            onClick={() => (action.prompt ? setPending(action) : fire(action, 0))}
          >
            <strong>{action.label}</strong>
            {action.hint && <span>{action.hint}</span>}
          </button>
        ))
      )}
    </div>
  )
}
