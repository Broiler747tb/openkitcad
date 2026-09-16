import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../doc/store'
import { FEATURE_HINT, FEATURE_ICON, FEATURE_LABEL, type Feature } from '../doc/types'
import {
  canMoveFeature,
  featureIndex,
  findComponent,
  markerIndex,
  timelineGroups,
  type GroupSpan,
} from '../doc/model'
import { GridSettings } from './PrecisionTools'
import { ContextMenu } from './ContextMenu'
import { editFeature } from './command/commands'
import { offerPick, sketchPick } from './command/picks'
import { useCommand } from './command/session'

const PLAY_STEP_MS = 450
const DRAG_SLOP_PX = 6

interface MenuItem {
  id: string
  label: string
  hint?: string
  danger?: boolean
  run: () => void
}

type Slot = { kind: 'step'; index: number } | { kind: 'group'; span: GroupSpan }

function slotsOf(length: number, spans: readonly GroupSpan[]): Slot[] {
  const slots: Slot[] = []
  for (let index = 0; index < length; index++) {
    const span = spans.find((candidate) => candidate.start === index)
    if (span) {
      slots.push({ kind: 'group', span })
      index = span.end
    } else {
      slots.push({ kind: 'step', index })
    }
  }
  return slots
}

export function Timeline({ onEdit }: { onEdit: () => void }) {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const errors = useStore((s) => s.errors)
  const activeSketch = useStore((s) => s.activeSketch)
  const editingId = useCommand((s) => s.session?.context.editingFeatureId)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [drop, setDrop] = useState<{ gap: number; valid: boolean } | null>(null)
  const [playing, setPlaying] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<{ featureId: string; x: number; dragging: boolean } | null>(null)

  const store = useStore.getState()
  const length = doc.timeline.length
  const marker = markerIndex(doc)
  const spans = timelineGroups(doc)
  const editIndex = editingId ? featureIndex(doc, editingId) : -1
  const failed = new Set(errors.filter((e) => e.severity === 'error').map((e) => e.featureId))
  const warned = new Set(errors.filter((e) => e.severity === 'warning').map((e) => e.featureId))
  const selectedIndex =
    selection.kind === 'feature' && selection.id ? featureIndex(doc, selection.id) : -1

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const state = useStore.getState()
      const at = markerIndex(state.doc)
      if (at >= state.doc.timeline.length) {
        setPlaying(false)
        return
      }
      state.setMarker(at + 1)
    }, PLAY_STEP_MS)
    return () => clearInterval(timer)
  }, [playing])

  function gapAt(clientX: number): number {
    const slots = [...(stripRef.current?.querySelectorAll<HTMLElement>('[data-start]') ?? [])]
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) return Number(slot.dataset.start)
    }
    return length
  }

  function edit(feature: Feature) {
    if (feature.kind === 'sketch') store.openSketch(feature.id)
    else if (!editFeature(feature)) {
      store.select({ kind: 'feature', id: feature.id })
      onEdit()
    }
  }

  function remove(feature: Feature) {
    if (store.removeFeature(feature.id)) return
    if (confirm(`Delete ${feature.name} and the steps that depend on it?`)) {
      store.removeFeature(feature.id, { withDependents: true })
    }
  }

  function stepMenu(feature: Feature, index: number): MenuItem[] {
    const items: MenuItem[] = [
      { id: 'edit', label: 'Edit Feature', run: () => edit(feature) },
      {
        id: 'suppress',
        label: feature.suppressed ? 'Unsuppress Features' : 'Suppress Features',
        hint: 'Turn the step off without deleting it.',
        run: () => store.updateFeature(feature.id, { suppressed: !feature.suppressed }),
      },
      {
        id: 'rollback',
        label: 'Roll History Marker Here',
        hint: 'Steps after this one are not built.',
        run: () => store.setMarker(index + 1),
      },
    ]
    if (range && range[0] !== range[1] && index >= range[0] && index <= range[1]) {
      items.push({
        id: 'group',
        label: 'Group Selected',
        hint: 'Fold these steps into one group on the timeline.',
        run: () => {
          store.groupSteps(doc.timeline[range[0]].id, doc.timeline[range[1]].id)
          setRange(null)
        },
      })
    }
    items.push({ id: 'delete', label: 'Delete', danger: true, run: () => remove(feature) })
    return items
  }

  function groupMenu(span: GroupSpan): MenuItem[] {
    return [
      {
        id: 'toggle',
        label: span.group.collapsed ? 'Expand Group' : 'Collapse Group',
        run: () => store.toggleGroup(span.group.id),
      },
      {
        id: 'rollback',
        label: 'Roll History Marker Here',
        run: () => store.setMarker(span.end + 1),
      },
      { id: 'ungroup', label: 'Ungroup', run: () => store.ungroup(span.group.id) },
    ]
  }

  function onStepPointerDown(e: React.PointerEvent<HTMLButtonElement>, feature: Feature) {
    if (e.button !== 0 || activeSketch) return
    pressRef.current = { featureId: feature.id, x: e.clientX, dragging: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onStepPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current
    if (!press) return
    if (!press.dragging && Math.abs(e.clientX - press.x) < DRAG_SLOP_PX) return
    press.dragging = true
    const from = featureIndex(doc, press.featureId)
    const gap = gapAt(e.clientX)
    const to = gap > from ? gap - 1 : gap
    setDrop({ gap, valid: to !== from && canMoveFeature(doc, press.featureId, to) })
  }

  function onStepPointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    feature: Feature,
    index: number,
  ) {
    const press = pressRef.current
    pressRef.current = null
    setDrop(null)
    if (!press) return
    if (press.dragging) {
      const gap = gapAt(e.clientX)
      const to = gap > index ? gap - 1 : gap
      if (to !== index) store.moveFeature(feature.id, to)
      return
    }
    if (offerPick(sketchPick(doc, feature.id))) return
    if (e.shiftKey && selectedIndex >= 0) {
      setRange([Math.min(selectedIndex, index), Math.max(selectedIndex, index)])
      return
    }
    setRange(null)
    store.select({ kind: 'feature', id: feature.id })
  }

  function stepButton(feature: Feature, index: number) {
    const component = findComponent(doc, feature.componentId)
    const where = component && component.id !== doc.rootComponentId ? `${component.name} · ` : ''
    const rolledBack = index >= marker || (editIndex >= 0 && index > editIndex)
    const state = [
      failed.has(feature.id) ? 'failed' : warned.has(feature.id) ? 'warned' : '',
      feature.suppressed ? 'suppressed' : '',
      rolledBack ? 'rolled back' : '',
    ].filter(Boolean)
    const classes = [
      'tl-step',
      feature.kind === 'sketch' ? 'tl-sketch' : '',
      index === selectedIndex ? 'selected' : '',
      range && index >= range[0] && index <= range[1] ? 'ranged' : '',
      failed.has(feature.id) ? 'failed' : warned.has(feature.id) ? 'warned' : '',
      feature.suppressed ? 'suppressed' : '',
      rolledBack ? 'rolled-back' : '',
      editIndex === index ? 'editing' : '',
    ]
    return (
      <button
        key={feature.id}
        className={classes.filter(Boolean).join(' ')}
        data-start={index}
        aria-pressed={index === selectedIndex}
        aria-label={`${where}${feature.name || FEATURE_LABEL[feature.kind]}${state.length ? `, ${state.join(', ')}` : ''}`}
        title={`${where}${feature.name || FEATURE_LABEL[feature.kind]} (${FEATURE_LABEL[feature.kind]})${state.length ? ` · ${state.join(' · ')}` : ''}\n${FEATURE_HINT[feature.kind]}\nDouble-click to edit. Drag to reorder.`}
        onPointerDown={(e) => onStepPointerDown(e, feature)}
        onPointerMove={onStepPointerMove}
        onPointerUp={(e) => onStepPointerUp(e, feature, index)}
        onPointerCancel={() => {
          pressRef.current = null
          setDrop(null)
        }}
        onDoubleClick={() => edit(feature)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!range || index < range[0] || index > range[1]) {
            setRange(null)
            store.select({ kind: 'feature', id: feature.id })
          }
          setMenu({ x: e.clientX, y: e.clientY, items: stepMenu(feature, index) })
        }}
      >
        {FEATURE_ICON[feature.kind]}
      </button>
    )
  }

  const markerHandle = (
    <span
      key="marker"
      className="tl-marker"
      role="slider"
      aria-label="History marker"
      aria-valuemin={0}
      aria-valuemax={length}
      aria-valuenow={marker}
      tabIndex={0}
      title="History marker. Drag it to roll the design back; steps to its right are not built."
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const move = (event: PointerEvent) => useStore.getState().setMarker(gapAt(event.clientX))
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') store.setMarker(Math.max(0, marker - 1))
        if (e.key === 'ArrowRight') store.setMarker(marker + 1)
      }}
    />
  )

  const indicator =
    drop &&
    ((key: string) => (
      <span key={key} className={`tl-drop ${drop.valid ? '' : 'invalid'}`} aria-hidden="true" />
    ))

  function withGaps(start: number, end: number, render: (index: number) => ReactNode) {
    const out: ReactNode[] = []
    for (let index = start; index <= end; index++) {
      if (index === marker) out.push(markerHandle)
      if (drop && drop.gap === index) out.push(indicator!(`drop-${index}`))
      out.push(render(index))
    }
    return out
  }

  const slots = slotsOf(length, spans)

  return (
    <section className="design-timeline tl" aria-label="Timeline">
      <div className="tl-playback" role="toolbar" aria-label="Playback">
        <button title="Go to the start" onClick={() => store.setMarker(0)} disabled={!length}>
          ⏮
        </button>
        <button
          title="Step back"
          onClick={() => store.setMarker(Math.max(0, marker - 1))}
          disabled={!length || marker === 0}
        >
          ◀
        </button>
        <button
          title={playing ? 'Pause' : 'Play the history step by step'}
          onClick={() => {
            if (!playing && marker >= length) store.setMarker(0)
            setPlaying(!playing)
          }}
          disabled={!length}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          title="Step forward"
          onClick={() => store.setMarker(marker + 1)}
          disabled={!length || marker >= length}
        >
          ▶|
        </button>
        <button
          title="Go to the end"
          onClick={() => store.setMarker(null)}
          disabled={!length || marker >= length}
        >
          ⏭
        </button>
      </div>
      <div className="tl-strip" ref={stripRef} role="toolbar" aria-label="Steps">
        {!length && (
          <span className="tl-empty">Create a sketch or solid to begin the feature history.</span>
        )}
        {slots.map((slot) => {
          if (slot.kind === 'step') {
            return (
              <Fragment key={doc.timeline[slot.index].id}>
                {withGaps(slot.index, slot.index, (index) =>
                  stepButton(doc.timeline[index], index),
                )}
              </Fragment>
            )
          }
          const { span } = slot
          const inside = doc.timeline.slice(span.start, span.end + 1)
          const groupFailed = inside.some((feature) => failed.has(feature.id))
          const openMenu = (e: React.MouseEvent) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, items: groupMenu(span) })
          }
          if (span.group.collapsed) {
            return (
              <Fragment key={span.group.id}>
                {marker === span.start && markerHandle}
                {drop?.gap === span.start && indicator!(`drop-${span.start}`)}
                <button
                  className={`tl-group-closed ${groupFailed ? 'failed' : ''} ${span.start >= marker ? 'rolled-back' : ''}`}
                  data-start={span.start}
                  title={`${span.group.name}: ${inside.length} steps. Click to expand.`}
                  onClick={() => store.toggleGroup(span.group.id)}
                  onContextMenu={openMenu}
                >
                  <span className="tl-group-icon">▤</span>
                  <span className="tl-group-count">{inside.length}</span>
                </button>
                {marker > span.start && marker <= span.end && markerHandle}
              </Fragment>
            )
          }
          return (
            <div key={span.group.id} className="tl-group-open" onContextMenu={openMenu}>
              <button
                className="tl-group-label"
                title="Collapse this group"
                onClick={() => store.toggleGroup(span.group.id)}
              >
                ▾ {span.group.name}
              </button>
              <div className="tl-group-steps">
                {withGaps(span.start, span.end, (index) => stepButton(doc.timeline[index], index))}
              </div>
            </div>
          )
        })}
        {marker >= length && length > 0 && markerHandle}
        {drop && drop.gap >= length && indicator!('drop-end')}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={menu.items}
          onPick={(item) => {
            setMenu(null)
            item.run()
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  )
}

export function NavigationBar() {
  const state = useStore()
  return (
    <div className="navigation-bar" aria-label="View navigation">
      <button
        title="Home view"
        onClick={() => window.dispatchEvent(new CustomEvent('okc:view', { detail: 'iso' }))}
      >
        ⌂
      </button>
      <button
        title="Fit view (Home)"
        onClick={() => window.dispatchEvent(new CustomEvent('okc:fit'))}
      >
        ⤢ Fit
      </button>
      <GridSettings />
      <button
        aria-pressed={state.section.enabled}
        onClick={() => state.setSection({ enabled: !state.section.enabled })}
      >
        Section
      </button>
    </div>
  )
}
