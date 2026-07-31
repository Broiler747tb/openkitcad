import { useEffect, useMemo, useRef, useState } from 'react'
import { ViewportEngine, type ScreenLabel } from './engine'
import { activeSketchFeature, newId, useStore } from '../doc/store'
import { frameFromPlaneRefLocal } from '../doc/planes'
import { findSnap, hitTestSketch, toggleSelection } from '../sketch/inference'
import { SketchMenu } from '../ui/SketchMenu'
import { ObjectMenu, objectActions, type PickedFace } from '../ui/ObjectMenu'
import { fmt, frameToWorld, v2, type Frame, type Vec2 } from '../core/math'
import type { Constraint, NewConstraint, Sketch2D } from '../sketch/types'

/** Snap radius in screen pixels. */
const SNAP_PX = 11
/** How far the pointer may travel and still count as a click rather than a drag. */
const CLICK_SLOP_PX = 4

/** Gizmo output is snapped to whole millimetres; keep the stored value tidy. */
const round = (n: number) => Math.round(n * 1000) / 1000

interface Draft {
  anchors: Vec2[]
  anchorIds: Array<string | null>
}

interface DimensionPrompt {
  x: number
  y: number
  value: string
  apply: (value: number) => void
}

export function Viewport() {
  const mountRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ViewportEngine | null>(null)
  const draftRef = useRef<Draft>({ anchors: [], anchorIds: [] })
  const draggingRef = useRef<{ pointId: string; moved: boolean } | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const [labels, setLabels] = useState<ScreenLabel[]>([])
  const [cursorHint, setCursorHint] = useState<{ x: number; y: number; text: string } | null>(null)
  const [prompt, setPrompt] = useState<DimensionPrompt | null>(null)
  const [, forceRender] = useState(0)

  const shapes = useStore((s) => s.shapes)
  const showPlacements = useStore((s) => s.showPlacements)
  const hovered = useStore((s) => s.hovered)
  const selection = useStore((s) => s.selection)
  const section = useStore((s) => s.section)
  const tool = useStore((s) => s.tool)
  const activeSketch = useStore((s) => s.activeSketch)
  const doc = useStore((s) => s.doc)
  const gizmoMode = useStore((s) => s.gizmoMode)
  const sketchSelection = useStore((s) => s.sketchSelection)
  const sketchStatus = useStore((s) => s.sketchStatus)
  const subSelection = useStore((s) => s.subSelection)
  const [menu, setMenu] = useState<{ x: number; y: number; cursor: Vec2 } | null>(null)
  const [objectMenu, setObjectMenu] = useState<{
    x: number
    y: number
    picked: PickedFace | null
  } | null>(null)

  // Memoised so they keep a stable identity across the renders the animation
  // loop triggers. Recomputing them on every render made the sketch-redraw
  // effect fire each frame, which fed straight back into another render.
  const sketchFeature = useMemo(
    () => (activeSketch ? activeSketchFeature(useStore.getState()) : null),
    [doc, activeSketch],
  )
  const frame: Frame | null = useMemo(
    () => (sketchFeature ? frameFromPlaneRefLocal(sketchFeature.plane) : null),
    [sketchFeature],
  )

  // --- engine lifecycle ----------------------------------------------------
  useEffect(() => {
    if (!mountRef.current) return
    const engine = new ViewportEngine(mountRef.current)
    engineRef.current = engine
    engine.onLabels = setLabels
    if (import.meta.env.DEV) (window as any).__okcEngine = engine

    engine.onGizmoChange = (position, rotationDeg) => {
      const store = useStore.getState()
      if (store.selection.kind !== 'placement' || !store.selection.id) return
      store.beginTransient()
      store.updatePlacement(
        store.selection.id,
        {
          position: [
            round(position[0]),
            round(position[1]),
            round(position[2]),
          ],
          // Keep it in 0-360 so the number in the panel reads sensibly.
          rotation: ((Math.round(rotationDeg * 10) / 10) % 360 + 360) % 360,
        },
        { transient: true },
      )
    }
    engine.onGizmoRelease = () => useStore.getState().endTransient()
    const observer = new ResizeObserver(() => engine.resize())
    observer.observe(mountRef.current)

    const onView = (e: Event) =>
      engine.setStandardView((e as CustomEvent).detail)
    const onFit = () => engine.frameAll()
    window.addEventListener('okc:view', onView)
    window.addEventListener('okc:fit', onFit)

    return () => {
      observer.disconnect()
      window.removeEventListener('okc:view', onView)
      window.removeEventListener('okc:fit', onFit)
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Show the move / turn gizmo on the selected catalogue part.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const placement =
      selection.kind === 'placement'
        ? doc.placements.find((p) => p.id === selection.id)
        : undefined
    if (!placement || activeSketch) {
      engine.setGizmo(null, gizmoMode)
    } else {
      engine.setGizmo(
        { position: placement.position, rotation: placement.rotation },
        gizmoMode,
      )
    }
  }, [selection, doc, gizmoMode, activeSketch])

  // Frame whenever geometry appears out of nothing: opening a document, or
  // turning the first sketch into a solid. Waiting for the shapes rather than
  // reacting to the button press is what makes this land on the real geometry,
  // since the kernel rebuild is asynchronous.
  const hadShapesRef = useRef(false)
  useEffect(() => {
    const has = shapes.length > 0
    if (has && !hadShapesRef.current) engineRef.current?.frameAll()
    hadShapesRef.current = has
  }, [shapes])

  useEffect(() => {
    engineRef.current?.setShapes(shapes, showPlacements)
  }, [shapes, showPlacements])

  useEffect(() => {
    engineRef.current?.setHighlight(hovered, selection.id ?? null)
  }, [hovered, selection])

  useEffect(() => {
    engineRef.current?.setSubHighlight(activeSketch ? [] : subSelection)
  }, [subSelection, activeSketch, shapes])

  useEffect(() => {
    engineRef.current?.setSection(
      section.enabled,
      section.axis,
      section.position,
      section.flipped,
    )
  }, [section])

  useEffect(() => {
    engineRef.current?.setOpacity(!!activeSketch)
    engineRef.current?.setSketchPlaneHint(frame)
    if (activeSketch && frame) engineRef.current?.lookAtFrame(frame)
    if (!activeSketch) {
      engineRef.current?.clearSketch()
      draftRef.current = { anchors: [], anchorIds: [] }
    }
    // Only when entering or leaving sketch mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSketch?.featureId])

  // Redraw the sketch whenever it changes.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (!sketchFeature || !frame) return
    engine.setSketch(
      sketchFeature.sketch,
      frame,
      null,
      selectionHighlight(sketchSelection),
      looseGeometry(sketchFeature.sketch, sketchStatus),
    )
    engine.setLabels(sketchLabels(sketchFeature.sketch, frame))
  }, [doc, sketchFeature, frame, sketchSelection, sketchStatus])

  // --- helpers -------------------------------------------------------------

  const toleranceAt = (): number => {
    const engine = engineRef.current
    if (!engine || !frame) return 1
    return engine.pixelSize(frame.origin) * SNAP_PX
  }

  const pointerToSketch = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const engine = engineRef.current
    if (!engine || !frame) return null
    return engine.pickOnPlane(e.clientX, e.clientY, frame)
  }

  /** Reuse a snapped point, or add a new one. */
  function ensurePoint(sketch: Sketch2D, pos: Vec2, snapId: string | null): string {
    if (snapId) return snapId
    const id = newId('p')
    sketch.points.push({ id, x: pos[0], y: pos[1] })
    return id
  }

  function pushConstraint(sketch: Sketch2D, c: NewConstraint) {
    sketch.constraints.push({ ...c, id: newId('c') } as Constraint)
  }

  // --- sketch drawing ------------------------------------------------------

  function commitClick(raw: Vec2) {
    const store = useStore.getState()
    const draft = draftRef.current
    const sketch = activeSketchFeature(store)?.sketch
    if (!sketch) return

    const snap = findSnap(sketch, raw, {
      tolerance: toleranceAt(),
      from: draft.anchors.length ? draft.anchors[draft.anchors.length - 1] : undefined,
    })

    draft.anchors.push(snap.point)
    draft.anchorIds.push(snap.snapToPointId)

    const finish = () => {
      draftRef.current = { anchors: [], anchorIds: [] }
    }

    if (tool === 'line' && draft.anchors.length === 2) {
      store.editSketch((s) => {
        const a = ensurePoint(s, draft.anchors[0], draft.anchorIds[0])
        const b = ensurePoint(s, draft.anchors[1], draft.anchorIds[1])
        const id = newId('e')
        s.entities.push({ id, kind: 'line', p1: a, p2: b, construction: false })
        if (snap.align === 'horizontal') pushConstraint(s, { kind: 'horizontal', e: id })
        if (snap.align === 'vertical') pushConstraint(s, { kind: 'vertical', e: id })
        if (snap.onEntityId && snap.onEntityKind === 'line') {
          pushConstraint(s, { kind: 'pointOnLine', p: b, e: snap.onEntityId })
        }
      })
      // Chain: keep drawing from the end of the segment just made.
      draftRef.current = {
        anchors: [draft.anchors[1]],
        anchorIds: [null],
      }
      store.solveActiveSketch()
    } else if (tool === 'rectangle' && draft.anchors.length === 2) {
      const [a, b] = draft.anchors
      store.editSketch((s) => {
        const p1 = ensurePoint(s, a, draft.anchorIds[0])
        const p2 = ensurePoint(s, [b[0], a[1]], null)
        const p3 = ensurePoint(s, b, draft.anchorIds[1])
        const p4 = ensurePoint(s, [a[0], b[1]], null)
        const e1 = newId('e')
        const e2 = newId('e')
        const e3 = newId('e')
        const e4 = newId('e')
        s.entities.push(
          { id: e1, kind: 'line', p1, p2, construction: false },
          { id: e2, kind: 'line', p1: p2, p2: p3, construction: false },
          { id: e3, kind: 'line', p1: p3, p2: p4, construction: false },
          { id: e4, kind: 'line', p1: p4, p2: p1, construction: false },
        )
        // A rectangle is only a rectangle because of these four constraints.
        pushConstraint(s, { kind: 'horizontal', e: e1 })
        pushConstraint(s, { kind: 'horizontal', e: e3 })
        pushConstraint(s, { kind: 'vertical', e: e2 })
        pushConstraint(s, { kind: 'vertical', e: e4 })
      })
      finish()
      store.solveActiveSketch()
      store.setTool('select')
    } else if (tool === 'circle' && draft.anchors.length === 2) {
      const [c, edge] = draft.anchors
      const radius = Math.max(v2.dist(c, edge), 0.5)
      store.editSketch((s) => {
        const centre = ensurePoint(s, c, draft.anchorIds[0])
        s.entities.push({
          id: newId('e'),
          kind: 'circle',
          c: centre,
          r: radius,
          construction: false,
        })
      })
      finish()
      store.solveActiveSketch()
      store.setTool('select')
    } else if (tool === 'arc' && draft.anchors.length === 3) {
      const [c, start, end] = draft.anchors
      store.editSketch((s) => {
        const centre = ensurePoint(s, c, draft.anchorIds[0])
        const p1 = ensurePoint(s, start, draft.anchorIds[1])
        // Force the end onto the arc's radius so the sketch starts consistent.
        const r = v2.dist(c, start)
        const dir = v2.norm(v2.sub(end, c))
        const p2 = ensurePoint(s, [c[0] + dir[0] * r, c[1] + dir[1] * r], draft.anchorIds[2])
        const a1 = Math.atan2(start[1] - c[1], start[0] - c[0])
        const a2 = Math.atan2(end[1] - c[1], end[0] - c[0])
        const ccw = ((a2 - a1 + Math.PI * 2) % (Math.PI * 2)) < Math.PI
        s.entities.push({
          id: newId('e'),
          kind: 'arc',
          c: centre,
          p1,
          p2,
          ccw,
          construction: false,
        })
      })
      finish()
      store.solveActiveSketch()
      store.setTool('select')
    }
    forceRender((n) => n + 1)
  }

  /** Preview chains for the tool currently mid-gesture. */
  function previewFor(cursor: Vec2): Vec2[][] | null {
    const draft = draftRef.current
    if (draft.anchors.length === 0) return null
    const a = draft.anchors[0]
    switch (tool) {
      case 'line':
        return [[draft.anchors[draft.anchors.length - 1], cursor]]
      case 'rectangle':
        return [
          [
            a,
            [cursor[0], a[1]],
            cursor,
            [a[0], cursor[1]],
            a,
          ],
        ]
      case 'circle': {
        const r = v2.dist(a, cursor)
        const ring: Vec2[] = []
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2
          ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)])
        }
        return [ring, [a, cursor]]
      }
      case 'arc': {
        if (draft.anchors.length === 1) return [[a, cursor]]
        const start = draft.anchors[1]
        const r = v2.dist(a, start)
        const a1 = Math.atan2(start[1] - a[1], start[0] - a[0])
        const a2 = Math.atan2(cursor[1] - a[1], cursor[0] - a[0])
        let sweep = a2 - a1
        while (sweep < 0) sweep += Math.PI * 2
        const chain: Vec2[] = []
        for (let i = 0; i <= 48; i++) {
          const t = a1 + (sweep * i) / 48
          chain.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)])
        }
        return [chain]
      }
      default:
        return null
    }
  }

  // --- pointer handling ----------------------------------------------------

  const onPointerMove = (e: React.PointerEvent) => {
    const engine = engineRef.current
    if (!engine) return
    const store = useStore.getState()

    if (activeSketch && frame) {
      const cursor = pointerToSketch(e)
      const sketch = activeSketchFeature(store)?.sketch
      if (!cursor || !sketch) return

      if (draggingRef.current) {
        const down = downRef.current
        // Pressing on a corner might be the start of a drag or might just be a
        // click to select it. Wait until the pointer actually travels before
        // committing to a drag, otherwise a corner can never be selected.
        if (
          !draggingRef.current.moved &&
          down &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_SLOP_PX
        ) {
          return
        }
        if (!draggingRef.current.moved) {
          draggingRef.current.moved = true
          store.beginTransient()
        }
        store.solveActiveSketch({
          point: draggingRef.current.pointId,
          x: cursor[0],
          y: cursor[1],
        })
        return
      }

      const snap = findSnap(sketch, cursor, {
        tolerance: toleranceAt(),
        from: draftRef.current.anchors.at(-1),
      })
      setCursorHint(
        snap.hint ? { x: e.clientX, y: e.clientY, text: snap.hint } : null,
      )
      const preview = tool === 'select' ? null : previewFor(snap.point)
      const highlight = selectionHighlight(store.sketchSelection)
      if (snap.snapToPointId) highlight.points.push(snap.snapToPointId)
      if (snap.onEntityId) highlight.entities.push(snap.onEntityId)
      engine.setSketch(
        sketch,
        frame,
        preview,
        highlight,
        looseGeometry(sketch, store.sketchStatus),
      )
      return
    }

    const hit = engine.pick(e.clientX, e.clientY)
    if (hit?.id !== store.hovered) store.setHovered(hit?.id ?? null)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const engine = engineRef.current
    if (!engine) return
    const store = useStore.getState()

    if (activeSketch && frame) {
      const cursor = pointerToSketch(e)
      const sketch = activeSketchFeature(store)?.sketch
      if (!cursor || !sketch) return

      if (tool === 'select') {
        // Grab a point to drag it.
        const snap = findSnap(sketch, cursor, { tolerance: toleranceAt(), gridStep: 0 })
        if (snap.snapToPointId && snap.snapToPointId !== 'origin') {
          draggingRef.current = { pointId: snap.snapToPointId, moved: false }
          downRef.current = { x: e.clientX, y: e.clientY }
          engine.setControlsEnabled(false)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
        // Not on a point: select whatever is under the cursor so the
        // right-click menu has something to work with. Shift adds to it.
        const hit = hitTestSketch(sketch, cursor, toleranceAt())
        store.setSketchSelection(
          hit
            ? e.shiftKey
              ? toggleSelection(store.sketchSelection, hit)
              : [hit]
            : [],
        )
        return
      }

      if (tool === 'dimension') {
        openDimensionFor(cursor, e.clientX, e.clientY)
        return
      }

      engine.setControlsEnabled(false)
      commitClick(cursor)
      return
    }

    // Outside sketch mode, left-drag orbits and a left *click* selects. Which
    // one this turns out to be is only known on release, so just remember where
    // it started. Selecting on press instead - the original behaviour - meant
    // every attempt to orbit also reselected whatever was under the cursor,
    // which is what made the view feel like it was fighting back.
    downRef.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const engine = engineRef.current
    const drag = draggingRef.current
    if (drag) {
      draggingRef.current = null
      downRef.current = null
      engine?.setControlsEnabled(true)
      const store = useStore.getState()
      if (drag.moved) {
        // Re-solve without the drag term so the result is exactly constrained.
        store.solveActiveSketch()
        store.endTransient()
      } else {
        // Never moved: that was a click on a corner, so select it.
        const target = { kind: 'point' as const, id: drag.pointId }
        store.setSketchSelection(
          e.shiftKey ? toggleSelection(store.sketchSelection, target) : [target],
        )
      }
      return
    }
    if (!activeSketch) engine?.setControlsEnabled(true)

    const down = downRef.current
    downRef.current = null
    if (activeSketch || !down || !engine || engine.isGizmoDragging()) return

    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return

    const store = useStore.getState()
    const hit = engine.pick(e.clientX, e.clientY)

    if (store.tool === 'measure') {
      if (hit) store.addMeasurePoint(hit.point)
      else store.setStatus('Click on a part, not empty space.')
      return
    }

    if (!hit) {
      if (!e.shiftKey) {
        store.select({ kind: 'none' })
        store.setSubSelection([])
      }
      return
    }

    store.select({ kind: hit.kind, id: hit.id })

    // Catalogue parts are moved as a whole, so picking their individual faces
    // would only get in the way of the gizmo.
    if (hit.kind !== 'body') {
      store.setSubSelection([])
      return
    }

    const sub = engine.pickSub(e.clientX, e.clientY)
    if (!sub) {
      store.setSubSelection([])
      return
    }
    const current = store.subSelection
    const at = current.findIndex((s) => s.bodyId === sub.bodyId && s.id === sub.id)
    store.setSubSelection(
      e.shiftKey
        ? at >= 0
          ? current.filter((_, i) => i !== at)
          : [...current, sub]
        : [sub],
    )
  }

  /** Dimension tool: click an entity, type a number. */
  function openDimensionFor(cursor: Vec2, screenX: number, screenY: number) {
    const store = useStore.getState()
    const sketch = activeSketchFeature(store)?.sketch
    if (!sketch) return
    const tolerance = toleranceAt()
    const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as Vec2]))

    for (const entity of sketch.entities) {
      if (entity.kind === 'line') {
        const a = pts.get(entity.p1)!
        const b = pts.get(entity.p2)!
        const mid = v2.mid(a, b)
        if (v2.dist(cursor, mid) > Math.max(tolerance * 3, v2.dist(a, b) / 2)) continue
        const ab = v2.sub(b, a)
        const len2 = v2.dot(ab, ab)
        const t = Math.max(0, Math.min(1, v2.dot(v2.sub(cursor, a), ab) / len2))
        const on: Vec2 = [a[0] + ab[0] * t, a[1] + ab[1] * t]
        if (v2.dist(cursor, on) > tolerance * 2) continue
        setPrompt({
          x: screenX,
          y: screenY,
          value: fmt(v2.dist(a, b)),
          apply: (value) => {
            store.addConstraint({ kind: 'distance', a: entity.p1, b: entity.p2, value })
          },
        })
        return
      }
      if (entity.kind === 'circle') {
        const c = pts.get(entity.c)!
        if (Math.abs(v2.dist(cursor, c) - entity.r) > tolerance * 2) continue
        setPrompt({
          x: screenX,
          y: screenY,
          value: fmt(entity.r * 2),
          apply: (value) => {
            store.addConstraint({ kind: 'diameter', e: entity.id, value })
          },
        })
        return
      }
    }
  }

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const store = useStore.getState()
      if (e.key === 'Escape') {
        if (draftRef.current.anchors.length) {
          draftRef.current = { anchors: [], anchorIds: [] }
          forceRender((n) => n + 1)
        } else if (store.tool !== 'select') {
          store.setTool('select')
        } else if (store.activeSketch) {
          store.closeSketch()
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? store.redo() : store.undo()
      }
      if (!store.activeSketch) return
      const map: Record<string, string> = { l: 'line', r: 'rectangle', c: 'circle', a: 'arc', d: 'dimension', s: 'select' }
      const next = map[e.key.toLowerCase()]
      if (next && !e.ctrlKey && !e.metaKey) store.setTool(next as never)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="viewport">
      <div
        ref={mountRef}
        className="viewport-canvas"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault()
          // Outside a sketch, right-click acts on the solid under the cursor.
          if (!activeSketch) {
            const engine = engineRef.current
            if (!engine) return
            const hit = engine.pick(e.clientX, e.clientY)
            const store = useStore.getState()
            store.select(hit ? { kind: hit.kind, id: hit.id } : { kind: 'none' })
            if (hit) {
              setObjectMenu({
                x: e.clientX,
                y: e.clientY,
                // Remember the exact face, so "draw on this face" lands where
                // the user pointed rather than on some default plane.
                picked:
                  hit.kind === 'body'
                    ? { bodyId: hit.id, point: hit.point, normal: hit.normal }
                    : null,
              })
            }
            return
          }
          // Mid-drawing, right-click means "stop this chain" - that has to keep
          // working, or the line tool becomes a trap.
          if (draftRef.current.anchors.length) {
            draftRef.current = { anchors: [], anchorIds: [] }
            forceRender((n) => n + 1)
            return
          }
          const store = useStore.getState()
          const sketch = activeSketchFeature(store)?.sketch
          const cursor = pointerToSketch(e)
          if (!sketch || !cursor) return
          // Right-click on nothing selected picks whatever is under the cursor,
          // so the common case needs no left-click first. But once something is
          // selected, right-clicking anywhere just opens the menu for it and
          // never changes it - otherwise right-clicking near the origin quietly
          // adds a third item and every option disappears.
          if (store.sketchSelection.length === 0) {
            const hit = hitTestSketch(sketch, cursor, toleranceAt())
            if (hit) store.setSketchSelection([hit])
          }
          setMenu({ x: e.clientX, y: e.clientY, cursor })
        }}
      />

      {labels.map((label) => (
        <div
          key={label.id}
          className={`vp-label vp-label-${label.kind}`}
          style={{ left: label.x, top: label.y }}
          title={
            label.kind === 'constraint'
              ? 'Click to remove this rule'
              : 'Click to change this size'
          }
          onPointerDown={(e) => {
            if (!activeSketch) return
            e.stopPropagation()
            if (label.kind === 'constraint') {
              useStore
                .getState()
                .applySketchAction({ kind: 'deleteConstraint', constraintId: label.id })
            } else {
              setPrompt({
                x: e.clientX,
                y: e.clientY,
                value: label.text.replace(/[^0-9.\-]/g, ''),
                apply: (value) => {
                  const store = useStore.getState()
                  store.editSketch((sketch) => {
                    const c = sketch.constraints.find((x) => x.id === label.id)
                    if (c && 'value' in c) c.value = value
                  })
                  store.solveActiveSketch()
                },
              })
            }
          }}
        >
          {label.text}
        </div>
      ))}

      {cursorHint && (
        <div
          className="vp-snap-hint"
          style={{ left: cursorHint.x + 14, top: cursorHint.y + 14 }}
        >
          {cursorHint.text}
        </div>
      )}

      {prompt && (
        <div className="vp-prompt" style={{ left: prompt.x, top: prompt.y }}>
          <input
            autoFocus
            defaultValue={prompt.value}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = Number((e.target as HTMLInputElement).value)
                if (Number.isFinite(value) && value > 0) prompt.apply(value)
                setPrompt(null)
              }
              if (e.key === 'Escape') setPrompt(null)
            }}
            onBlur={() => setPrompt(null)}
          />
          <span>mm</span>
        </div>
      )}

      {menu && activeSketch && (
        <SketchMenu
          x={menu.x}
          y={menu.y}
          cursor={menu.cursor}
          onClose={() => setMenu(null)}
        />
      )}

      {objectMenu && !activeSketch && (
        <ObjectMenu
          x={objectMenu.x}
          y={objectMenu.y}
          actions={objectActions(selection, objectMenu.picked)}
          onClose={() => setObjectMenu(null)}
        />
      )}

      <ViewCube />
    </div>
  )
}

/** Split a sketch selection into the shape the engine wants for highlighting. */
function selectionHighlight(selection: { kind: string; id: string }[]): {
  points: string[]
  entities: string[]
} {
  return {
    points: selection.filter((s) => s.kind === 'point').map((s) => s.id),
    entities: selection.filter((s) => s.kind === 'entity').map((s) => s.id),
  }
}

/**
 * Which geometry the solver still lets move. An edge counts as loose if either
 * of its ends does, which is what makes a half-pinned rectangle read correctly:
 * the two edges touching the anchored corner stay white, the rest go blue.
 */
function looseGeometry(
  sketch: Sketch2D,
  status: { freePoints: string[]; freeRadii: string[] } | null,
): { points: string[]; entities: string[] } {
  if (!status) return { points: [], entities: [] }
  const freePoints = new Set(status.freePoints)
  const entities: string[] = []
  for (const e of sketch.entities) {
    const moves =
      e.kind === 'line'
        ? freePoints.has(e.p1) || freePoints.has(e.p2)
        : e.kind === 'circle'
          ? freePoints.has(e.c) || status.freeRadii.includes(e.id)
          : freePoints.has(e.c) || freePoints.has(e.p1) || freePoints.has(e.p2)
    if (moves) entities.push(e.id)
  }
  return { points: status.freePoints, entities }
}

/** Short symbols for the constraints that carry no number. */
const GLYPH: Partial<Record<Constraint['kind'], string>> = {
  horizontal: 'H',
  vertical: 'V',
  parallel: '//',
  perpendicular: '⊥',
  equal: '=',
  tangent: '⌒',
  coincident: '•',
  fix: '×',
  pointOnLine: '—',
  pointOnCircle: '○',
  midpoint: '|',
  symmetric: '><',
}

/**
 * Everything the sketch has been told, drawn on the sketch.
 *
 * Dimensions show their number; the rest show a small symbol. Both are
 * clickable, because a constraint you cannot see is a constraint you cannot
 * remove, and "why won't this move?" with no way to find out is the single
 * most demoralising thing about parametric CAD.
 */
function sketchLabels(sketch: Sketch2D, frame: Frame) {
  const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as Vec2]))
  const out: Array<{
    id: string
    text: string
    at: [number, number, number]
    kind: 'dimension' | 'constraint'
  }> = []

  const entityAnchor = (entityId: string): Vec2 | null => {
    const entity = sketch.entities.find((e) => e.id === entityId)
    if (!entity) return null
    if (entity.kind === 'line') {
      const a = pts.get(entity.p1)
      const b = pts.get(entity.p2)
      return a && b ? v2.mid(a, b) : null
    }
    return pts.get(entity.c) ?? null
  }

  // Spread glyphs that land on the same spot so they do not stack up.
  const used = new Map<string, number>()
  const nudge = (p: Vec2): Vec2 => {
    const key = `${Math.round(p[0])},${Math.round(p[1])}`
    const n = used.get(key) ?? 0
    used.set(key, n + 1)
    return [p[0], p[1] - n * 4]
  }

  for (const c of sketch.constraints) {
    if (c.kind === 'distance' || c.kind === 'distanceX' || c.kind === 'distanceY') {
      const a = pts.get(c.a)
      const b = pts.get(c.b)
      if (!a || !b) continue
      out.push({
        id: c.id,
        text: fmt(c.value),
        at: frameToWorld(frame, v2.mid(a, b)),
        kind: 'dimension',
      })
      continue
    }
    if (c.kind === 'radius' || c.kind === 'diameter') {
      const anchor = entityAnchor(c.e)
      if (!anchor) continue
      out.push({
        id: c.id,
        text: c.kind === 'radius' ? `R${fmt(c.value)}` : `⌀${fmt(c.value)}`,
        at: frameToWorld(frame, anchor),
        kind: 'dimension',
      })
      continue
    }
    if (c.kind === 'angle') {
      const anchor = entityAnchor(c.a)
      if (!anchor) continue
      out.push({
        id: c.id,
        text: `${fmt(c.value)}°`,
        at: frameToWorld(frame, anchor),
        kind: 'dimension',
      })
      continue
    }

    const glyph = GLYPH[c.kind]
    if (!glyph) continue
    // The origin's own pin is noise: it is there in every sketch and can never
    // be removed, so drawing it just trains people to ignore glyphs.
    if (c.kind === 'fix' && c.p === 'origin') continue

    let anchor: Vec2 | null = null
    if ('e' in c && typeof c.e === 'string') anchor = entityAnchor(c.e)
    else if ('line' in c) anchor = entityAnchor(c.line)
    else if ('a' in c && typeof c.a === 'string') {
      anchor = pts.get(c.a) ?? entityAnchor(c.a)
    } else if ('p' in c) anchor = pts.get(c.p) ?? null
    if (!anchor) continue

    out.push({
      id: c.id,
      text: glyph,
      at: frameToWorld(frame, nudge(anchor)),
      kind: 'constraint',
    })
  }
  return out
}

function ViewCube() {
  return (
    <div className="view-cube">
      {(['top', 'front', 'right', 'iso'] as const).map((view) => (
        <button
          key={view}
          title={
            view === 'iso' ? 'Three-quarter view' : `Look straight at the ${view}`
          }
          onClick={() => window.dispatchEvent(new CustomEvent('okc:view', { detail: view }))}
        >
          {view === 'iso' ? '3D' : view[0].toUpperCase() + view.slice(1)}
        </button>
      ))}
    </div>
  )
}
