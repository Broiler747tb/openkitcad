import { useEffect, useId, useState } from 'react'
import { SelectionActions } from './SelectionActions'
import { PrecisionSketchTools } from './PrecisionTools'
import { SketchPowerTools, SceneTools } from './PowerTools'
import { chooseAction, chooseSketchAction } from './ActionDialog'
import { mountFeature, objectActions } from './ObjectMenu'
import { FlyoutMenu } from './FlyoutMenu'
import { activeSketchFeature, bodyBounds, newId, targetBodies, useStore } from '../doc/store'
import { sketchActions } from '../sketch/actions'
import { CONFIDENCE_LABEL, getPart } from '../catalogue'
import { fmt } from '../core/math'
import type { BodyOperation, Feature } from '../doc/types'
import { findBody, findComponent, findFeature, findOccurrence } from '../doc/model'
import { poseOf, withPose, type Pose } from '../doc/placement'
import { kernel } from '../kernel/api'
import type { Clash, PrintWarning } from '../kernel/types'
import { quantity } from '../core/quantity'
import { lengthLabel, lengthText, volumeLabel } from '../core/units'

export function Inspector({
  tab,
  onTab,
}: {
  tab: 'properties' | 'actions' | 'checks'
  onTab: (tab: 'properties' | 'actions' | 'checks') => void
}) {
  const selection = useStore((s) => s.selection)
  const errors = useStore((s) => s.errors)
  const activeSketch = useStore((s) => s.activeSketch)

  if (activeSketch) {
    return (
      <div className="panel-right">
        <div className="panel-caption">SKETCH PALETTE</div>
        <SketchPowerTools key={activeSketch.featureId} />
        <details className="sketch-panel-group">
          <summary>Pointer coordinates & polar input</summary>
          <PrecisionSketchTools />
        </details>
        <details className="sketch-panel-group">
          <summary>Selection dimensions & constraints</summary>
          <SketchSelectionPanel />
        </details>
      </div>
    )
  }

  return (
    <div className="panel-right">
      {errors.length > 0 && (
        <div className="section">
          <h3>Needs attention</h3>
          {errors.map((e, i) => (
            <div className={`msg ${e.severity === 'warning' ? 'warn' : 'error'}`} key={i}>
              <strong>{e.message}</strong>
              {e.hint && <em>{e.hint}</em>}
            </div>
          ))}
        </div>
      )}

      <div className="tabs inspector-tabs">
        {(['properties', 'actions', 'checks'] as const).map((t) => (
          <button className={tab === t ? 'active' : ''} key={t} onClick={() => onTab(t)}>
            {t === 'properties' ? 'Properties' : t === 'actions' ? 'Actions' : 'Checks'}
          </button>
        ))}
      </div>
      {tab !== 'checks' && <SceneTools />}
      {tab === 'checks' ? (
        <ToolsSection />
      ) : tab === 'actions' ? (
        <>
          <SelectionActions />
          {selection.kind === 'none' && (
            <div className="empty">Select a body or hardware part to see its actions.</div>
          )}
        </>
      ) : (
        <>
          <SubSelectionPanel />
          {selection.kind === 'occurrence' && (
            <OccurrenceInspector
              key={selection.id}
              id={selection.id!}
              instanceId={selection.instanceId}
            />
          )}
          {selection.kind === 'body' && (
            <BodyInspector id={selection.id!} instanceId={selection.instanceId} />
          )}
          {selection.kind === 'feature' && (
            <FeatureInspector key={selection.id} featureId={selection.id!} />
          )}
          {selection.kind === 'none' && (
            <div className="section">
              <h3>Nothing selected</h3>
              <p className="hint">
                Click a part in the 3D view or in the list on the left to change it.
              </p>
            </div>
          )}

          {selection.kind !== 'none' && (
            <button className="inspector-action-link" onClick={() => onTab('actions')}>
              Show all actions for this selection →
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
  min,
  suffix = 'mm',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  suffix?: string
}) {
  const id = useId()
  const units = useStore((s) => s.doc.units)
  const isLength = suffix === 'mm'
  const shown = isLength ? lengthText(value, units) : String(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = () => {
    if (draft.trim() === shown) return
    let v: number
    try {
      v = quantity(draft, isLength ? units : suffix === '°' ? '°' : '')
    } catch {
      setDraft(shown)
      return
    }
    if (min != null && v < min) {
      setDraft(shown)
      return
    }
    if (v !== value) onChange(v)
  }
  return (
    <div className="row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(shown)
          }
        }}
      />
      <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 20 }}>
        {isLength ? units : suffix}
      </span>
    </div>
  )
}

function OccurrenceInspector({ id, instanceId }: { id: string; instanceId?: string }) {
  const doc = useStore((s) => s.doc)
  const instances = useStore((s) => s.instances)
  const meshes = useStore((s) => s.meshes)
  const activeComponentId = useStore((s) => s.activeComponentId)
  const store = useStore.getState()
  const [targetBody, setTargetBody] = useState('')
  const [standoffHeight, setStandoffHeight] = useState<number | null>(null)
  const occurrence = findOccurrence(doc, id)
  const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
  if (!occurrence || !component) return null
  const pose = poseOf(occurrence.transform)
  const setPose = (patch: Partial<Pose>) =>
    store.updateOccurrence(id, { transform: withPose(occurrence.transform, patch) })
  const source = component.source
  const part = source.kind === 'catalogue' ? getPart(source.partId) : undefined
  const bodies = targetBodies(doc)
  const body = bodies.some((b) => b.value === targetBody) ? targetBody : (bodies[0]?.value ?? '')
  const top = body ? bodyBounds({ instances, meshes }, body)?.[5] : undefined
  const targetTopZ = top ?? pose.position[2]
  const suggestedStandoff = Math.max(Math.round((pose.position[2] - targetTopZ) * 10) / 10, 5)
  const pillarHeight = standoffHeight ?? suggestedStandoff

  const generate = (kind: 'holes' | 'standoffs' | 'ports') => {
    if (!body) {
      store.setStatus('Make a plate or box first - there is nothing to put holes in yet.')
      return
    }
    const feature = mountFeature(kind, id, body, { height: pillarHeight, instanceId })
    if (!feature) return
    store.addFeature(feature)
    store.select({ kind: 'body', id: body })
  }

  return (
    <>
      <div className="section">
        <h3>{occurrence.name}</h3>
        {part && (
          <p className="hint" style={{ marginTop: 0 }}>
            {part.summary}
          </p>
        )}
        <Num
          label="Across (X)"
          value={pose.position[0]}
          onChange={(v) => setPose({ position: [v, pose.position[1], pose.position[2]] })}
        />
        <Num
          label="Along (Y)"
          value={pose.position[1]}
          onChange={(v) => setPose({ position: [pose.position[0], v, pose.position[2]] })}
        />
        <Num
          label="Height (Z)"
          value={pose.position[2]}
          onChange={(v) => setPose({ position: [pose.position[0], pose.position[1], v] })}
        />
        <Num
          label="Turn"
          value={pose.turn}
          step={15}
          suffix="°"
          onChange={(v) => setPose({ turn: v })}
        />
        <div className="row">
          <label>Upside down</label>
          <input
            type="checkbox"
            checked={pose.flipped}
            onChange={(e) => setPose({ flipped: e.target.checked })}
          />
        </div>
        {source.kind === 'catalogue' && part?.geometry.kind === 'extrusion' && (
          <Num
            label="Length"
            value={source.overrides?.length ?? part.geometry.length}
            step={10}
            min={10}
            onChange={(v) =>
              store.updateComponent(component.id, {
                source: { ...source, overrides: { ...source.overrides, length: v } },
              })
            }
          />
        )}
      </div>

      <div className="section">
        <h3>Component</h3>
        <button
          className="btn"
          title="Another occurrence of the same component. Changing one changes both."
          onClick={() => store.linkedCopy(id)}
        >
          Linked Copy
          <small>Another occurrence of {component.name} beside this one</small>
        </button>
        {source.kind === 'design' && (
          <button
            className="btn"
            disabled={activeComponentId === component.id}
            title="New sketches, bodies and features go into the active component."
            onClick={() => store.activateComponent(component.id)}
          >
            {activeComponentId === component.id ? 'Active component' : 'Activate Component'}
            <small>New sketches, bodies and features go into {component.name}</small>
          </button>
        )}
      </div>

      {part && (
        <div className="section">
          <h3>Build around this part</h3>
          {bodies.length > 1 && (
            <div className="row">
              <label>Into</label>
              <select value={body} onChange={(e) => setTargetBody(e.target.value)}>
                {bodies.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="btn"
            disabled={!part.mountingHoles?.length}
            onClick={() => generate('holes')}
          >
            Mounting holes
            <small>
              {part.mountingHoles?.length
                ? `${part.mountingHoles.length} holes, sized for ${part.mountingHoles[0].screw ?? 'the screws'}, cut right through`
                : 'This part has no mounting holes'}
            </small>
          </button>

          {!!part.mountingHoles?.length && (
            <Num
              label="Pillar height"
              value={pillarHeight}
              min={0.5}
              onChange={setStandoffHeight}
            />
          )}
          <button
            className="btn"
            disabled={!part.mountingHoles?.length}
            onClick={() => generate('standoffs')}
          >
            Standoffs
            <small>
              {standoffHeight === null
                ? `Printed pillars ${lengthLabel(pillarHeight, doc.units)} tall under each hole, which is where the board is sitting`
                : `Printed pillars ${lengthLabel(pillarHeight, doc.units)} tall under each hole, bored for a self-tapping screw`}
            </small>
          </button>

          <button
            className="btn"
            disabled={!part.connectors?.length}
            onClick={() => generate('ports')}
          >
            Port openings
            <small>
              {part.connectors?.length
                ? `Cuts openings for ${part.connectors
                    .map((c) => c.label)
                    .slice(0, 3)
                    .join(', ')}${part.connectors.length > 3 ? '…' : ''}`
                : 'This part has no connectors listed'}
            </small>
          </button>
        </div>
      )}

      {part && (
        <div className="section">
          <h3>About this part</h3>
          <div className={`msg ${part.confidence === 'approximate' ? 'warn' : 'info'}`}>
            <strong>{CONFIDENCE_LABEL[part.confidence]}</strong>
            <em>{part.source}</em>
          </div>
          {part.electrical && (
            <p className="hint" style={{ marginTop: 0 }}>
              {part.electrical.voltage && <>Runs on {part.electrical.voltage.join(' or ')} V. </>}
              {part.electrical.currentPeak != null && (
                <>Draws up to {part.electrical.currentPeak} A. </>
              )}
              {part.electrical.note}
            </p>
          )}
          {part.links?.map((link) => (
            <p className="hint" key={link.url} style={{ margin: '4px 0 0' }}>
              <a className="link" href={link.url} target="_blank" rel="noreferrer noopener">
                {link.label} ↗
              </a>
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function BodyInspector({ id, instanceId }: { id: string; instanceId?: string }) {
  const doc = useStore((s) => s.doc)
  const instances = useStore((s) => s.instances)
  const meshes = useStore((s) => s.meshes)
  const found = findBody(doc, id)
  const store = useStore.getState()
  if (!found) return null
  const { body } = found
  const instance =
    instances.find((i) => i.id === instanceId) ??
    instances.find((i) => i.kind === 'body' && i.bodyId === id)
  const mesh = instance ? meshes.get(instance.meshKey) : undefined
  const units = doc.units
  const size = mesh
    ? [
        mesh.bounds[3] - mesh.bounds[0],
        mesh.bounds[4] - mesh.bounds[1],
        mesh.bounds[5] - mesh.bounds[2],
      ]
    : null
  const show = (mm: number) => (units === 'mm' ? fmt(mm, 1) : lengthLabel(mm, units, false))

  return (
    <>
      <div className="section">
        <h3>{body.name}</h3>
        <div className="row">
          <label>Name</label>
          <input
            value={body.name}
            onChange={(e) => store.updateBody(id, { name: e.target.value })}
          />
        </div>
        {size && mesh && (
          <p className="hint mono" style={{ marginTop: 8 }}>
            {show(size[0])} × {show(size[1])} × {show(size[2])} {units}
            <br />
            {volumeLabel(mesh.volume, units)} of material
          </p>
        )}
      </div>

      <div className="section">
        <h3>Quick actions</h3>
        {objectActions({ kind: 'body', id })
          .filter((a) => ['size', 'round', 'bevel', 'sketch-on-top'].includes(a.id))
          .map((action) => (
            <button key={action.id} className="btn" onClick={() => chooseAction(action)}>
              {action.label}
              <small>{action.hint}</small>
            </button>
          ))}
      </div>
    </>
  )
}

function resultValue(result: BodyOperation): string {
  if (result.kind === 'newBody') return 'new'
  if (result.kind === 'join') return `join:${result.bodyId}`
  return `${result.kind}:${result.bodyIds[0] ?? ''}`
}

function FeatureInspector({ featureId }: { featureId: string }) {
  const doc = useStore((s) => s.doc)
  const feature = findFeature(doc, featureId)
  const store = useStore.getState()
  if (!feature) return null

  const patch = (p: Partial<Feature>) => store.updateFeature(featureId, p)
  const component = findComponent(doc, feature.componentId)

  return (
    <div className="section">
      <h3>{feature.name}</h3>

      {feature.kind === 'sketch' && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {feature.sketch.entities.length} line
            {feature.sketch.entities.length === 1 ? '' : 's'} drawn.
          </p>
          <button className="btn primary" onClick={() => store.openSketch(featureId)}>
            Edit this sketch
          </button>
        </>
      )}

      {feature.kind === 'extrude' && (
        <>
          <Num
            label="Thickness"
            value={feature.distance}
            min={0.1}
            onChange={(v) => patch({ distance: v } as Partial<Feature>)}
          />
          <div className="row">
            <label>Direction</label>
            <select
              value={feature.reverse ? 'down' : 'up'}
              onChange={(e) => patch({ reverse: e.target.value === 'down' } as Partial<Feature>)}
            >
              <option value="up">Upwards</option>
              <option value="down">Downwards</option>
            </select>
          </div>
          <div className="row">
            <label title="New Body, Join or Cut">Operation</label>
            <select
              value={resultValue(feature.result)}
              onChange={(e) => {
                const [kind, bodyId] = e.target.value.split(':')
                const result: BodyOperation =
                  kind === 'join'
                    ? { kind: 'join', bodyId }
                    : kind === 'cut'
                      ? { kind: 'cut', bodyIds: [bodyId] }
                      : {
                          kind: 'newBody',
                          bodyId:
                            feature.result.kind === 'newBody'
                              ? feature.result.bodyId
                              : newId('body'),
                        }
                patch({ result } as Partial<Feature>)
              }}
            >
              <option value="new">New Body</option>
              {component?.bodies
                .filter((b) => feature.result.kind !== 'newBody' || b.id !== feature.result.bodyId)
                .flatMap((b) => [
                  <option key={`join:${b.id}`} value={`join:${b.id}`}>
                    Join to {b.name}
                  </option>,
                  <option key={`cut:${b.id}`} value={`cut:${b.id}`}>
                    Cut {b.name}
                  </option>,
                ])}
            </select>
          </div>
        </>
      )}

      {feature.kind === 'revolve' && (
        <>
          <Num
            label="How far round"
            value={feature.angle}
            step={15}
            min={1}
            suffix="°"
            onChange={(v) => patch({ angle: Math.min(360, v) } as Partial<Feature>)}
          />
          <div className="row">
            <label>Spin about</label>
            <select
              value={feature.axis}
              onChange={(e) => patch({ axis: e.target.value } as Partial<Feature>)}
            >
              <option value="x">The sideways axis</option>
              <option value="y">The upright axis</option>
            </select>
          </div>
          <p className="hint">
            Draw the outline to one side of the axis, not across it, or it will try to pass through
            itself.
          </p>
        </>
      )}

      {feature.kind === 'sphere' && (
        <>
          <Num
            label="Radius"
            value={feature.radius}
            min={0.1}
            onChange={(v) => patch({ radius: v } as Partial<Feature>)}
          />
          <div className="row">
            <label>Shape</label>
            <select
              value={feature.half ? 'half' : 'full'}
              onChange={(e) => patch({ half: e.target.value === 'half' } as Partial<Feature>)}
            >
              <option value="full">A whole ball</option>
              <option value="half">A dome, flat side down</option>
            </select>
          </div>
        </>
      )}

      {feature.kind === 'vent' && (
        <>
          <div className="row">
            <label>Hole shape</label>
            <select
              value={feature.shape}
              onChange={(e) => patch({ shape: e.target.value } as Partial<Feature>)}
            >
              <option value="hex">Hexagons</option>
              <option value="round">Round</option>
              <option value="square">Square</option>
            </select>
          </div>
          <Num
            label={feature.shape === 'hex' ? 'Across flats' : 'Hole size'}
            value={feature.size}
            step={0.5}
            min={0.2}
            onChange={(v) => patch({ size: v } as Partial<Feature>)}
          />
          <Num
            label="Gap between"
            value={feature.spacing}
            step={0.2}
            min={0.2}
            onChange={(v) => patch({ spacing: v } as Partial<Feature>)}
          />
          <Num
            label="Edge border"
            value={feature.margin}
            step={0.5}
            min={0}
            onChange={(v) => patch({ margin: v } as Partial<Feature>)}
          />
          <p className="hint">
            The border is solid material left all the way round, so the grid never runs off the edge
            and leaves slivers that snap off.
          </p>
        </>
      )}

      {feature.kind === 'lid' && (
        <>
          <Num
            label="Thickness"
            value={feature.thickness}
            min={0.2}
            onChange={(v) => patch({ thickness: v } as Partial<Feature>)}
          />
          <p className="hint">
            A separate body, so you can hide it to see inside, vent it, or export it on its own.
          </p>
        </>
      )}

      {feature.kind === 'hole' && (
        <>
          <div className="row">
            <label>Type</label>
            <select
              value={feature.style}
              onChange={(e) => patch({ style: e.target.value } as Partial<Feature>)}
            >
              <option value="simple">Plain hole</option>
              <option value="counterbore">Counterbored (screw head sits flush)</option>
              <option value="countersink">Countersunk (for a tapered head)</option>
            </select>
          </div>
          <Num
            label="Hole size"
            value={feature.diameter}
            step={0.1}
            min={0.5}
            onChange={(v) => patch({ diameter: v } as Partial<Feature>)}
          />
          {feature.style !== 'simple' && (
            <>
              <Num
                label="Head size"
                value={feature.counterboreDiameter ?? feature.diameter * 2}
                step={0.1}
                onChange={(v) => patch({ counterboreDiameter: v } as Partial<Feature>)}
              />
              {feature.style === 'counterbore' && (
                <Num
                  label="Head depth"
                  value={feature.counterboreDepth ?? 2}
                  step={0.1}
                  onChange={(v) => patch({ counterboreDepth: v } as Partial<Feature>)}
                />
              )}
            </>
          )}
          <div className="row">
            <label>Depth</label>
            <select
              value={feature.depth === 'through' ? 'through' : 'blind'}
              onChange={(e) =>
                patch({ depth: e.target.value === 'through' ? 'through' : 5 } as Partial<Feature>)
              }
            >
              <option value="through">All the way through</option>
              <option value="blind">A set depth</option>
            </select>
          </div>
          {feature.depth !== 'through' && (
            <Num
              label="Deep"
              value={feature.depth}
              onChange={(v) => patch({ depth: v } as Partial<Feature>)}
            />
          )}
          {feature.source.kind === 'occurrence' && (
            <p className="hint">
              These follow the part they were made for. Move the board and the holes move with it.
            </p>
          )}
        </>
      )}

      {feature.kind === 'standoff' && (
        <>
          <Num
            label="Height"
            value={feature.height}
            min={0.5}
            onChange={(v) => patch({ height: v } as Partial<Feature>)}
          />
          <Num
            label="Pillar size"
            value={feature.outerDiameter}
            step={0.5}
            onChange={(v) => patch({ outerDiameter: v } as Partial<Feature>)}
          />
          <Num
            label="Screw hole"
            value={feature.boreDiameter}
            step={0.1}
            onChange={(v) => patch({ boreDiameter: v } as Partial<Feature>)}
          />
          <Num
            label="Hole depth"
            value={feature.boreDepth}
            step={0.5}
            onChange={(v) => patch({ boreDepth: v } as Partial<Feature>)}
          />
          <p className="hint">
            For a self-tapping screw make the hole about 0.4 mm under the screw size. For a brass
            heat-set insert, use the insert's recommended hole instead.
          </p>
        </>
      )}

      {feature.kind === 'portCutout' && (
        <>
          <Num
            label="Extra room"
            value={feature.tolerance}
            step={0.1}
            onChange={(v) => patch({ tolerance: v } as Partial<Feature>)}
          />
          <p className="hint">
            Added all the way round each opening. 0.5 mm is usually enough for a printed wall; go
            bigger if your printer runs wide.
          </p>
        </>
      )}

      {feature.kind === 'fillet' && (
        <Num
          label="Radius"
          value={feature.radius}
          min={0.1}
          onChange={(v) => patch({ radius: v } as Partial<Feature>)}
        />
      )}
      {feature.kind === 'chamfer' && (
        <Num
          label="Size"
          value={feature.distance}
          min={0.1}
          onChange={(v) => patch({ distance: v } as Partial<Feature>)}
        />
      )}
      {feature.kind === 'shell' && (
        <Num
          label="Wall"
          value={feature.thickness}
          min={0.2}
          onChange={(v) => patch({ thickness: v } as Partial<Feature>)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Faces, edges and corners picked on a solid. */
function SubSelectionPanel() {
  const picks = useStore((s) => s.subSelection)
  if (picks.length === 0) return null
  const count = (kind: string) => picks.filter((p) => p.kind === kind).length
  const parts = [
    [count('face'), 'face', 'faces'],
    [count('edge'), 'edge', 'edges'],
    [count('vertex'), 'corner', 'corners'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)

  return (
    <div className="section">
      <h3>Picked on the shape</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {parts.join(', ')} selected. Shift-click to add more, then use Actions for what you can do
        with them.
      </p>
      <button className="btn" onClick={() => useStore.getState().setSubSelection([])}>
        Clear the selection
      </button>
    </div>
  )
}

function SketchSelectionPanel() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.sketchSelection)
  const status = useStore((s) => s.sketchStatus)
  const store = useStore.getState()
  const sketch = activeSketchFeature(useStore.getState())?.sketch
  if (!sketch) return null
  const units = doc.units

  const pts = new Map(sketch.points.map((p) => [p.id, p]))
  const actions = sketchActions(sketch, selection)
  const single = selection.length === 1 ? selection[0] : null
  const entity =
    single?.kind === 'entity' ? sketch.entities.find((e) => e.id === single.id) : undefined

  return (
    <>
      <div className="section">
        <h3>This sketch</h3>
        {status && (
          <p className="hint" style={{ marginTop: 0 }}>
            {status.failing.length > 0
              ? 'Some of the sizes you have set contradict each other.'
              : status.dof === 0
                ? 'Fully defined. Nothing can move by accident.'
                : `${status.dof} thing${status.dof === 1 ? '' : 's'} can still move. Set more sizes to lock it down.`}
          </p>
        )}
      </div>

      {selection.length === 0 ? (
        <div className="section">
          <h3>Nothing picked</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Click a line, a circle or a corner. Shift-click to add a second one. Available
            dimensions and constraints appear here.
          </p>
        </div>
      ) : (
        <div className="section">
          <h3>
            {entity
              ? entity.kind === 'line'
                ? 'Line'
                : entity.kind === 'circle'
                  ? 'Circle'
                  : 'Arc'
              : single?.kind === 'point'
                ? 'Corner'
                : `${selection.length} things picked`}
          </h3>

          {entity?.kind === 'line' &&
            (() => {
              const a = pts.get(entity.p1)!
              const b = pts.get(entity.p2)!
              const length = Math.hypot(b.x - a.x, b.y - a.y)
              const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
              return (
                <>
                  <Num
                    label="Length"
                    value={Math.round(length * 1000) / 1000}
                    step={1}
                    min={0.01}
                    onChange={(value) =>
                      store.addConstraint({
                        kind: 'distance',
                        a: entity.p1,
                        b: entity.p2,
                        value,
                      })
                    }
                  />
                  <p className="hint mono" style={{ marginTop: 0 }}>
                    runs at {fmt(angle, 1)}° from horizontal
                  </p>
                </>
              )
            })()}

          {entity?.kind === 'circle' && (
            <Num
              label="Diameter"
              value={Math.round(entity.r * 2000) / 1000}
              step={1}
              min={0.02}
              onChange={(value) => store.addConstraint({ kind: 'diameter', e: entity.id, value })}
            />
          )}

          {single?.kind === 'point' &&
            (() => {
              const p = pts.get(single.id)
              return p ? (
                <p className="hint mono" style={{ marginTop: 0 }}>
                  at {lengthLabel(p.x, units, false)}, {lengthLabel(p.y, units)}
                </p>
              ) : null
            })()}

          {actions.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>What you can do</h3>
              <FlyoutMenu actions={actions} onPick={chooseSketchAction} />
            </>
          )}
        </div>
      )}
    </>
  )
}

function ToolsSection() {
  const section = useStore((s) => s.section)
  const instances = useStore((s) => s.instances)
  const doc = useStore((s) => s.doc)
  const store = useStore.getState()
  const [clashes, setClashes] = useState<Clash[] | null>(null)
  const [warnings, setWarnings] = useState<PrintWarning[] | null>(null)
  const [busy, setBusy] = useState(false)
  const printable = instances.filter((i) => i.kind === 'body' && i.visible)

  return (
    <>
      <div className="section">
        <h3>Look inside</h3>
        <div className="row">
          <label>Cut away</label>
          <input
            type="checkbox"
            checked={section.enabled}
            onChange={(e) => store.setSection({ enabled: e.target.checked })}
          />
        </div>
        {section.enabled && (
          <>
            <div className="row">
              <label>Direction</label>
              <select
                value={section.axis}
                onChange={(e) => store.setSection({ axis: e.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">Left to right</option>
                <option value="y">Front to back</option>
                <option value="z">Top to bottom</option>
              </select>
            </div>
            <Num
              label="Position"
              value={section.position}
              step={1}
              onChange={(v) => store.setSection({ position: v })}
            />
            <div className="row">
              <label>Other side</label>
              <input
                type="checkbox"
                checked={section.flipped}
                onChange={(e) => store.setSection({ flipped: e.target.checked })}
              />
            </div>
          </>
        )}
      </div>

      <div className="section">
        <h3>Check the design</h3>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setWarnings(null)
            try {
              setClashes(await kernel().clearance(doc))
            } finally {
              setBusy(false)
            }
          }}
        >
          Check for clashes
          <small>Does anything overlap something it shouldn't?</small>
        </button>

        <button
          className="btn"
          disabled={busy || printable.length === 0}
          onClick={async () => {
            setBusy(true)
            setClashes(null)
            try {
              setWarnings(
                await kernel().printPrep(
                  printable.map((i) => i.id),
                  { nozzle: 0.4, bed: [220, 220, 250] },
                ),
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          Check it will print
          <small>Overhangs, thin walls, and whether it fits the bed</small>
        </button>

        {clashes?.length === 0 && <div className="msg info">Nothing overlaps. All clear.</div>}
        {clashes?.map((c, i) => (
          <div className="msg warn" key={i}>
            <strong>
              {c.aLabel} runs into {c.bLabel}
            </strong>
            <em>Overlapping by roughly {lengthLabel(c.overlap, doc.units)}.</em>
          </div>
        ))}

        {warnings?.length === 0 && <div className="msg info">No printing problems spotted.</div>}
        {warnings?.map((w, i) => (
          <div className={`msg ${w.severity === 'error' ? 'error' : 'warn'}`} key={i}>
            <strong>{w.message}</strong>
            {w.hint && <em>{w.hint}</em>}
          </div>
        ))}
      </div>
    </>
  )
}
