import { useState } from 'react'
import { newId, useStore } from '../doc/store'
import { CONFIDENCE_LABEL, getPart } from '../catalogue'
import { fmt } from '../core/math'
import type { Feature, HoleFeature, StandoffFeature } from '../doc/types'
import { kernel } from '../kernel/api'
import type { Clash, PrintWarning } from '../kernel/types'

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const errors = useStore((s) => s.errors)

  return (
    <div className="panel-right">
      {errors.length > 0 && (
        <div className="section">
          <h3>Needs attention</h3>
          {errors.map((e, i) => (
            <div className="msg error" key={i}>
              <strong>{e.message}</strong>
              {e.hint && <em>{e.hint}</em>}
            </div>
          ))}
        </div>
      )}

      {selection.kind === 'placement' && <PlacementInspector id={selection.id!} />}
      {selection.kind === 'body' && <BodyInspector id={selection.id!} />}
      {selection.kind === 'feature' && (
        <FeatureInspector bodyId={selection.bodyId!} featureId={selection.id!} />
      )}
      {selection.kind === 'none' && (
        <div className="section">
          <h3>Nothing selected</h3>
          <p className="hint">
            Click a part in the 3D view or in the list on the left to change it.
          </p>
        </div>
      )}

      <ToolsSection />
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
  step = 0.5,
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
  return (
    <div className="row">
      <label>{label}</label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
      <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 20 }}>{suffix}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function PlacementInspector({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const placement = doc.placements.find((p) => p.id === id)
  const store = useStore.getState()
  const [targetBody, setTargetBody] = useState('')
  if (!placement) return null
  const part = getPart(placement.partId)
  const body = targetBody || doc.bodies[0]?.id || ''

  const generate = (make: (planeZ: number) => Feature) => {
    if (!body) {
      store.setStatus('Make a plate or box first - there is nothing to put holes in yet.')
      return
    }
    // Drill from the top of the target body, which is what a board sitting on a
    // plate almost always means.
    const shape = store.shapes.find((s) => s.id === body)
    const topZ = shape ? shape.bounds[5] : placement.position[2]
    store.addFeature(body, make(topZ))
    store.select({ kind: 'body', id: body })
  }

  return (
    <>
      <div className="section">
        <h3>{placement.name}</h3>
        {part && <p className="hint" style={{ marginTop: 0 }}>{part.summary}</p>}
        <Num
          label="Across (X)"
          value={placement.position[0]}
          onChange={(v) =>
            store.updatePlacement(id, { position: [v, placement.position[1], placement.position[2]] })
          }
        />
        <Num
          label="Along (Y)"
          value={placement.position[1]}
          onChange={(v) =>
            store.updatePlacement(id, { position: [placement.position[0], v, placement.position[2]] })
          }
        />
        <Num
          label="Height (Z)"
          value={placement.position[2]}
          onChange={(v) =>
            store.updatePlacement(id, { position: [placement.position[0], placement.position[1], v] })
          }
        />
        <Num
          label="Turn"
          value={placement.rotation}
          step={15}
          suffix="°"
          onChange={(v) => store.updatePlacement(id, { rotation: v })}
        />
        <div className="row">
          <label>Upside down</label>
          <input
            type="checkbox"
            checked={placement.flipped}
            onChange={(e) => store.updatePlacement(id, { flipped: e.target.checked })}
          />
        </div>
        {part?.geometry.kind === 'extrusion' && (
          <Num
            label="Length"
            value={placement.overrides?.length ?? part.geometry.length}
            step={10}
            min={10}
            onChange={(v) =>
              store.updatePlacement(id, { overrides: { ...placement.overrides, length: v } })
            }
          />
        )}
      </div>

      <div className="section">
        <h3>Build around this part</h3>
        {doc.bodies.length > 1 && (
          <div className="row">
            <label>Into</label>
            <select value={body} onChange={(e) => setTargetBody(e.target.value)}>
              {doc.bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          className="btn"
          disabled={!part?.mountingHoles?.length}
          onClick={() =>
            generate((z) => ({
              id: newId('hole'),
              kind: 'hole',
              name: `Holes for ${placement.name}`,
              plane: { kind: 'named', name: 'XY', offset: z },
              source: { kind: 'placement', placementId: id },
              style: 'counterbore',
              diameter: (part?.mountingHoles?.[0]?.diameter ?? 3) + 0.2,
              depth: 'through',
              counterboreDiameter: (part?.mountingHoles?.[0]?.diameter ?? 3) + 3,
              counterboreDepth: 2,
            } as HoleFeature))
          }
        >
          Mounting holes
          <small>
            {part?.mountingHoles?.length
              ? `${part.mountingHoles.length} holes, sized for ${part.mountingHoles[0].screw ?? 'the screws'}, cut right through`
              : 'This part has no mounting holes'}
          </small>
        </button>

        <button
          className="btn"
          disabled={!part?.mountingHoles?.length}
          onClick={() =>
            generate((z) => ({
              id: newId('standoff'),
              kind: 'standoff',
              name: `Standoffs for ${placement.name}`,
              plane: { kind: 'named', name: 'XY', offset: z },
              source: { kind: 'placement', placementId: id },
              height: Math.max(placement.position[2] - z, 5),
              outerDiameter: (part?.mountingHoles?.[0]?.diameter ?? 3) + 3,
              boreDiameter: Math.max((part?.mountingHoles?.[0]?.diameter ?? 3) - 0.6, 1.2),
              boreDepth: 4,
            } as StandoffFeature))
          }
        >
          Standoffs
          <small>Printed pillars under each hole, bored for a self-tapping screw</small>
        </button>

        <button
          className="btn"
          disabled={!part?.connectors?.length}
          onClick={() =>
            generate(() => ({
              id: newId('ports'),
              kind: 'portCutout',
              name: `Openings for ${placement.name}`,
              placementId: id,
              connectorIds: [],
              tolerance: 0.6,
            }))
          }
        >
          Port openings
          <small>
            {part?.connectors?.length
              ? `Cuts openings for ${part.connectors.map((c) => c.label).slice(0, 3).join(', ')}${part.connectors.length > 3 ? '…' : ''}`
              : 'This part has no connectors listed'}
          </small>
        </button>
      </div>

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

function BodyInspector({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const shapes = useStore((s) => s.shapes)
  const body = doc.bodies.find((b) => b.id === id)
  const shape = shapes.find((s) => s.id === id)
  const store = useStore.getState()
  if (!body) return null

  const size = shape
    ? [
        shape.bounds[3] - shape.bounds[0],
        shape.bounds[4] - shape.bounds[1],
        shape.bounds[5] - shape.bounds[2],
      ]
    : null

  return (
    <>
      <div className="section">
        <h3>{body.name}</h3>
        <div className="row">
          <label>Name</label>
          <input
            value={body.name}
            onChange={(e) =>
              store.commit((d) => {
                const b = d.bodies.find((x) => x.id === id)
                if (b) b.name = e.target.value
              })
            }
          />
        </div>
        {size && (
          <p className="hint mono" style={{ marginTop: 8 }}>
            {fmt(size[0], 1)} × {fmt(size[1], 1)} × {fmt(size[2], 1)} mm
            <br />
            {fmt((shape!.volume / 1000), 1)} cm³ of material
          </p>
        )}
      </div>

      <div className="section">
        <h3>Change the shape</h3>
        <button
          className="btn"
          onClick={() =>
            store.addFeature(id, {
              id: newId('fillet'),
              kind: 'fillet',
              name: 'Round edges',
              radius: 2,
              edges: [],
            })
          }
        >
          Round off every edge
          <small>Softens all the corners at once</small>
        </button>
        <button
          className="btn"
          onClick={() =>
            store.addFeature(id, {
              id: newId('chamfer'),
              kind: 'chamfer',
              name: 'Bevel edges',
              distance: 1,
              edges: [],
            })
          }
        >
          Bevel every edge
          <small>A flat 45° cut instead of a round</small>
        </button>
        <button
          className="btn"
          onClick={() =>
            store.startSketch(
              { kind: 'named', name: 'XY', offset: shape ? shape.bounds[5] : 0 },
              id,
            )
          }
        >
          Sketch on top of this
          <small>Draw on the highest face to add or cut more</small>
        </button>
      </div>
    </>
  )
}

function FeatureInspector({ bodyId, featureId }: { bodyId: string; featureId: string }) {
  const doc = useStore((s) => s.doc)
  const body = doc.bodies.find((b) => b.id === bodyId)
  const feature = body?.features.find((f) => f.id === featureId)
  const store = useStore.getState()
  if (!feature) return null

  const patch = (p: Partial<Feature>) => store.updateFeature(bodyId, featureId, p)

  return (
    <div className="section">
      <h3>{feature.name}</h3>

      {feature.kind === 'sketch' && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {feature.sketch.entities.length} line
            {feature.sketch.entities.length === 1 ? '' : 's'} drawn.
          </p>
          <button className="btn primary" onClick={() => store.openSketch(bodyId, featureId)}>
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
            <label>What it does</label>
            <select
              value={feature.operation}
              onChange={(e) => patch({ operation: e.target.value } as Partial<Feature>)}
            >
              <option value="new">Start a new shape</option>
              <option value="add">Add to the shape</option>
              <option value="cut">Cut into the shape</option>
            </select>
          </div>
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
          <Num label="Hole size" value={feature.diameter} step={0.1} min={0.5} onChange={(v) => patch({ diameter: v } as Partial<Feature>)} />
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
            <Num label="Deep" value={feature.depth} onChange={(v) => patch({ depth: v } as Partial<Feature>)} />
          )}
          {feature.source.kind === 'placement' && (
            <p className="hint">
              These follow the part they were made for. Move the board and the holes move with it.
            </p>
          )}
        </>
      )}

      {feature.kind === 'standoff' && (
        <>
          <Num label="Height" value={feature.height} min={0.5} onChange={(v) => patch({ height: v } as Partial<Feature>)} />
          <Num label="Pillar size" value={feature.outerDiameter} step={0.5} onChange={(v) => patch({ outerDiameter: v } as Partial<Feature>)} />
          <Num label="Screw hole" value={feature.boreDiameter} step={0.1} onChange={(v) => patch({ boreDiameter: v } as Partial<Feature>)} />
          <Num label="Hole depth" value={feature.boreDepth} step={0.5} onChange={(v) => patch({ boreDepth: v } as Partial<Feature>)} />
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
        <Num label="Radius" value={feature.radius} min={0.1} onChange={(v) => patch({ radius: v } as Partial<Feature>)} />
      )}
      {feature.kind === 'chamfer' && (
        <Num label="Size" value={feature.distance} min={0.1} onChange={(v) => patch({ distance: v } as Partial<Feature>)} />
      )}
      {feature.kind === 'shell' && (
        <Num label="Wall" value={feature.thickness} min={0.2} onChange={(v) => patch({ thickness: v } as Partial<Feature>)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ToolsSection() {
  const section = useStore((s) => s.section)
  const shapes = useStore((s) => s.shapes)
  const doc = useStore((s) => s.doc)
  const store = useStore.getState()
  const [clashes, setClashes] = useState<Clash[] | null>(null)
  const [warnings, setWarnings] = useState<PrintWarning[] | null>(null)
  const [busy, setBusy] = useState(false)

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
          disabled={busy || shapes.length === 0}
          onClick={async () => {
            setBusy(true)
            setClashes(null)
            try {
              const bodies = shapes.filter((s) => s.kind === 'body').map((s) => s.id)
              setWarnings(
                await kernel().printPrep(bodies, { nozzle: 0.4, bed: [220, 220, 250] }),
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
            <em>Overlapping by roughly {fmt(c.overlap, 1)} mm.</em>
          </div>
        ))}

        {warnings?.length === 0 && (
          <div className="msg info">No printing problems spotted.</div>
        )}
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
