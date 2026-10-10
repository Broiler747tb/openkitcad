import { t } from '../i18n'
import { partSummary } from './parts/translation'
import { useEffect, useState } from 'react'
import { SelectionActions } from './SelectionActions'
import { PrecisionSketchTools } from './PrecisionTools'
import { SketchPowerTools, SceneTools } from './PowerTools'
import { chooseAction, chooseSketchAction } from './ActionDialog'
import { mountFeature, objectActions, portOpeningsFor, setPortOpenings } from './ObjectMenu'
import { FlyoutMenu } from './FlyoutMenu'
import { activeSketchFeature, bodyBounds, newId, targetBodies, useStore } from '../doc/store'
import { usePreferences } from '../doc/preferences'
import { startConstraintTool } from './sketchConstraints'
import { sketchActions } from '../sketch/actions'
import {
  adjustableDimensions,
  allParts,
  byPopularity,
  CONFIDENCE_LABEL,
  getPart,
  hasHeaderChoice,
  headersFitted,
} from '../catalogue'
import { fmt } from '../core/math'
import type { BodyOperation, Feature, JointFeature } from '../doc/types'
import type { DofLimits } from '../assembly/types'
import { motionDofs } from '../assembly/motion'
import { editFeature } from './command/commands'
import { DOF_LABEL, MOTION_OPTIONS, driveJoint, updateJoint } from './command/specs/assemble'
import { animateJoint, useJointAnimation } from './jointAnimation'
import { findBody, findComponent, findFeature, findOccurrence } from '../doc/model'
import { poseOf, withPose, type Pose } from '../doc/placement'
import { DesignChecks } from './DesignChecks'
import { HistoryProblems } from './HistoryProblems'
import { SketchDiagnostics } from './SketchDiagnostics'
import { MeasurePanel } from './MeasurePanel'
import { NumberInput as Num } from './NumberInput'
import { lengthLabel, volumeLabel } from '../core/units'
import { counted } from '../i18n'

function SketchOptions() {
  const values = usePreferences((s) => s.values)
  const setPreference = usePreferences((s) => s.set)
  const store = useStore()
  const sketch = activeSketchFeature(store)
  const selected = store.sketchSelection.filter((t) => t.kind === 'entity')
  const option = (key: keyof typeof values, label: string, hint: string) => (
    <label className="sketch-option" title={t(hint)}>
      <input
        type="checkbox"
        checked={values[key] as boolean}
        onChange={(e) => setPreference({ [key]: e.target.checked })}
      />
      {t(label)}
    </label>
  )
  return (
    <section className="section sketch-options">
      <h3>{t('Options')}</h3>
      <div className="sketch-linetype">
        <span>{t('Linetype')}</span>
        <button
          title={t(
            'Construction - turns the selected curves into guides that are not part of any profile',
          )}
          disabled={!selected.length}
          onClick={() => {
            store.editSketch((draft) => {
              const ids = new Set(selected.map((t) => t.id))
              const picked = draft.entities.filter((e) => ids.has(e.id))
              const make = picked.some((e) => !e.construction)
              for (const e of picked) e.construction = make
            })
          }}
        >
          {t('┄ Construction')}
        </button>
        <button
          title={t('Fix/UnFix - pins the selection where it is, or releases it')}
          disabled={!store.sketchSelection.length}
          onClick={() => startConstraintTool('fix')}
        >
          {t('🔒 Fix/UnFix')}
        </button>
      </div>
      <button
        className="btn sketch-look-at"
        title={t('Look At - turns the view to face the sketch')}
        onClick={() => window.dispatchEvent(new CustomEvent('okc:look-at'))}
      >
        {t('Look At')}
      </button>
      {option('gridVisible', 'Sketch Grid', 'Shows the grid on the sketch plane.')}
      {option('snapGrid', 'Snap', 'Clicks land on the grid when nothing else is near.')}
      {option('sketchSlice', 'Slice', 'Cuts away the bodies in front of the sketch plane.')}
      {option('sketchShowProfile', 'Show Profile', 'Shades the closed areas you can extrude.')}
      {option('sketchShowPoints', 'Show Points', 'Shows the end points and centres.')}
      {option('sketchShowDimensions', 'Show Dimensions', 'Shows the sizes you have set.')}
      {option('sketchShowConstraints', 'Show Constraints', 'Shows the constraint glyphs.')}
      {sketch && (
        <p className="hint">
          {store.sketchStatus
            ? store.sketchStatus.dof === 0
              ? t('Fully constrained.')
              : t(
                  '{0} degree{1} of freedom left.',
                  store.sketchStatus.dof,
                  store.sketchStatus.dof === 1 ? '' : 's',
                )
            : ''}
        </p>
      )}
      <button className="btn finish-sketch-palette" onClick={() => store.closeSketch()}>
        {t('✓ Finish Sketch')}
      </button>
    </section>
  )
}

export function Inspector({
  tab,
  onTab,
}: {
  tab: 'properties' | 'actions' | 'checks'
  onTab: (tab: 'properties' | 'actions' | 'checks') => void
}) {
  const selection = useStore((s) => s.selection)
  const activeSketch = useStore((s) => s.activeSketch)

  if (activeSketch) {
    return (
      <div className="panel-right">
        <div className="panel-caption">{t('SKETCH PALETTE')}</div>
        <MeasurePanel />
        <SketchOptions />
        <SketchDiagnostics />
        <details className="sketch-panel-group">
          <summary>{t('Sketch workshop')}</summary>
          <SketchPowerTools key={activeSketch.featureId} />
        </details>
        <details className="sketch-panel-group">
          <summary>{t('Pointer coordinates & polar input')}</summary>
          <PrecisionSketchTools />
        </details>
        <details className="sketch-panel-group">
          <summary>{t('Selection dimensions & constraints')}</summary>
          <SketchSelectionPanel />
        </details>
      </div>
    )
  }

  return (
    <div className="panel-right">
      <HistoryProblems onProperties={() => onTab('properties')} />
      <MeasurePanel />

      <div className="tabs inspector-tabs">
        {(['properties', 'actions', 'checks'] as const).map((item) => (
          <button className={tab === item ? 'active' : ''} key={item} onClick={() => onTab(item)}>
            {item === 'properties'
              ? t('Properties')
              : item === 'actions'
                ? t('Actions')
                : t('Checks')}
          </button>
        ))}
      </div>
      {tab !== 'checks' && <SceneTools />}
      {tab === 'properties' && <SelectionActions compact />}
      {tab === 'checks' ? (
        <DesignChecks />
      ) : tab === 'actions' ? (
        <>
          <SelectionActions />
          {selection.kind === 'none' && (
            <div className="empty">{t('Select a body or hardware part to see its actions.')}</div>
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
              <h3>{t('Nothing selected')}</h3>
              <p className="hint">
                {t('Click a part in the 3D view or in the list on the left to change it.')}
              </p>
            </div>
          )}

          {selection.kind !== 'none' && (
            <button className="inspector-action-link" onClick={() => onTab('actions')}>
              {t('Show all actions for this selection →')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function JointPanel({ feature }: { feature: JointFeature }) {
  const doc = useStore((s) => s.doc)
  const [problem, setProblem] = useState<string | null>(null)
  const animating = useJointAnimation((s) => s.jointId === feature.id)
  const dofs = motionDofs(feature.motion)
  const motion = MOTION_OPTIONS.find((option) => option.value === feature.motion.kind)
  const owner = (path: string[]) =>
    path.length
      ? (findOccurrence(doc, path[path.length - 1])?.name ?? 'a missing component')
      : doc.name || 'the top design'
  const current = dofs.map((_, index) => feature.values[index] ?? 0)
  const setLimit = (index: number, change: Partial<DofLimits>) => {
    const limits = dofs.map((_, i) => ({ ...(feature.limits[i] ?? {}) }))
    limits[index] = { ...limits[index], ...change }
    setProblem(updateJoint(feature.id, { limits }))
  }
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        {t(motion?.label ?? 'Joint')}
        {t(' between ')}
        {owner(feature.one.occurrencePath)}
        {t(' and')} {owner(feature.two.occurrencePath)}. {t(motion?.hint)}
      </p>
      {dofs.map((dof, index) => {
        const unit = dof.kind === 'rotate' ? '°' : 'mm'
        const limit = feature.limits[index] ?? {}
        const span = dof.kind === 'rotate' ? 90 : 10
        return (
          <div key={dof.name} className="joint-dof">
            <Num
              label={DOF_LABEL[dof.name]}
              value={current[index]}
              step={dof.kind === 'rotate' ? 15 : 1}
              suffix={unit}
              onChange={(value) =>
                setProblem(
                  driveJoint(
                    feature.id,
                    current.map((old, i) => (i === index ? value : old)),
                  ),
                )
              }
            />
            <label className="sketch-option">
              <input
                type="checkbox"
                checked={limit.min !== undefined}
                onChange={(e) =>
                  setLimit(index, { min: e.target.checked ? current[index] - span : undefined })
                }
              />
              {t('Minimum')}
            </label>
            {limit.min !== undefined && (
              <Num
                label={t('Minimum')}
                value={limit.min}
                suffix={unit}
                onChange={(value) => setLimit(index, { min: value })}
              />
            )}
            <label className="sketch-option">
              <input
                type="checkbox"
                checked={limit.max !== undefined}
                onChange={(e) =>
                  setLimit(index, { max: e.target.checked ? current[index] + span : undefined })
                }
              />
              {t('Maximum')}
            </label>
            {limit.max !== undefined && (
              <Num
                label={t('Maximum')}
                value={limit.max}
                suffix={unit}
                onChange={(value) => setLimit(index, { max: value })}
              />
            )}
          </div>
        )
      })}
      {dofs.length > 0 && (
        <label className="sketch-option">
          <input
            type="checkbox"
            checked={!!feature.locked}
            onChange={(e) => setProblem(updateJoint(feature.id, { locked: e.target.checked }))}
          />
          {t('Lock')}
        </label>
      )}
      {problem && <p className="hint error">{t(problem)}</p>}
      {dofs.length > 0 && !feature.locked && (
        <button
          className="btn"
          disabled={animating}
          onClick={() => {
            const failed = animateJoint(feature.id)
            setProblem(failed)
            if (!failed) {
              useStore
                .getState()
                .setStatus('Animating the joint. Click anywhere or press a key to stop.')
            }
          }}
        >
          {animating ? t('Click anywhere to stop') : t('Animate Joint')}
        </button>
      )}
      <button className="btn primary" onClick={() => editFeature(feature)}>
        {t('Edit Joint')}
      </button>
    </>
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
  const versions = part?.family
    ? allParts()
        .filter((p) => p.family === part.family)
        .sort(byPopularity)
    : []
  const bodies = targetBodies(doc)
  const body = bodies.some((b) => b.value === targetBody) ? targetBody : (bodies[0]?.value ?? '')
  const top = body ? bodyBounds({ instances, meshes }, body)?.[5] : undefined
  const targetTopZ = top ?? pose.position[2]
  const suggestedStandoff = Math.max(Math.round((pose.position[2] - targetTopZ) * 10) / 10, 5)
  const pillarHeight = standoffHeight ?? suggestedStandoff
  const portsEnabled = portOpeningsFor(doc, id, body, instanceId).some(
    (feature) => !feature.suppressed,
  )

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
            {partSummary(part)}
          </p>
        )}
        {part?.family && versions.length > 1 && (
          <div className="row">
            <label>{t('Version')}</label>
            <select
              aria-label={t('Part version')}
              title={t('Swap this part for another version. Its position is kept.')}
              value={part.id}
              onChange={(e) => store.swapCataloguePart(component.id, e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.variant ?? v.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Num
          label={t('Across (X)')}
          value={pose.position[0]}
          onChange={(v) => setPose({ position: [v, pose.position[1], pose.position[2]] })}
        />
        <Num
          label={t('Along (Y)')}
          value={pose.position[1]}
          onChange={(v) => setPose({ position: [pose.position[0], v, pose.position[2]] })}
        />
        <Num
          label={t('Height (Z)')}
          value={pose.position[2]}
          onChange={(v) => setPose({ position: [pose.position[0], pose.position[1], v] })}
        />
        <Num
          label={t('Turn')}
          value={pose.turn}
          step={15}
          suffix="°"
          onChange={(v) => setPose({ turn: v })}
        />
        <div className="row">
          <label>{t('Upside down')}</label>
          <input
            type="checkbox"
            checked={pose.flipped}
            onChange={(e) => setPose({ flipped: e.target.checked })}
          />
        </div>
        {source.kind === 'catalogue' && part && hasHeaderChoice(part) && (
          <div
            className="row"
            title={t(
              'Soldered pin headers. Untick for a board sold bare or soldered flat; tick to add them to one sold without.',
            )}
          >
            <label>{t('Pin headers')}</label>
            <input
              type="checkbox"
              aria-label={t('Pin headers fitted')}
              checked={source.headers ?? headersFitted(part)}
              onChange={(e) =>
                store.updateComponent(component.id, {
                  source: { ...source, headers: e.target.checked },
                })
              }
            />
          </div>
        )}
        {source.kind === 'catalogue' &&
          part &&
          adjustableDimensions(part).map((field) => (
            <Num
              key={field.key}
              label={t(field.label)}
              value={source.overrides?.[field.key] ?? field.value}
              step={field.step}
              min={field.min}
              max={field.max}
              onChange={(v) =>
                store.updateComponent(component.id, {
                  source: { ...source, overrides: { ...source.overrides, [field.key]: v } },
                })
              }
            />
          ))}
      </div>

      <div className="section">
        <h3>{t('Component')}</h3>
        <button
          className="btn"
          title={t('Another occurrence of the same component. Changing one changes both.')}
          onClick={() => store.linkedCopy(id)}
        >
          {t('Linked Copy')}
          <small>
            {t('Another occurrence of ')}
            {component.name}
            {t(' beside this one')}
          </small>
        </button>
        {source.kind === 'design' && (
          <button
            className="btn"
            disabled={activeComponentId === component.id}
            title={t('New sketches, bodies and features go into the active component.')}
            onClick={() => store.activateComponent(component.id)}
          >
            {activeComponentId === component.id ? t('Active component') : t('Activate Component')}
            <small>
              {t('New sketches, bodies and features go into ')}
              {component.name}
            </small>
          </button>
        )}
      </div>

      {part && (
        <div className="section">
          <h3>{t('Build around this part')}</h3>
          {bodies.length > 1 && (
            <div className="row">
              <label>{t('Into')}</label>
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
            {t('Mounting holes')}
            <small>
              {part.mountingHoles?.length
                ? t(
                    '{0}, sized for {1}, cut right through',
                    counted(part.mountingHoles.length, 'hole'),
                    part.mountingHoles[0].screw ?? 'the screws',
                  )
                : t('This part has no mounting holes')}
            </small>
          </button>

          {!!part.mountingHoles?.length && (
            <Num
              label={t('Pillar height')}
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
            {t('Standoffs')}
            <small>
              {standoffHeight === null
                ? t(
                    'Printed pillars {0} tall under each hole, which is where the board is sitting',
                    lengthLabel(pillarHeight, doc.units),
                  )
                : t(
                    'Printed pillars {0} tall under each hole, bored for a self-tapping screw',
                    lengthLabel(pillarHeight, doc.units),
                  )}
            </small>
          </button>

          <label className="sketch-option">
            <input
              type="checkbox"
              checked={portsEnabled}
              disabled={!body || !part.connectors?.length}
              onChange={(e) => setPortOpenings(id, body, e.target.checked, instanceId)}
            />
            {t('Port openings')}
          </label>
        </div>
      )}

      {part && (
        <div className="section">
          <h3>{t('About this part')}</h3>
          <div className={`msg ${part.confidence === 'approximate' ? 'warn' : 'info'}`}>
            <strong>{t(CONFIDENCE_LABEL[part.confidence])}</strong>
            <em>{part.source}</em>
          </div>
          {part.electrical && (
            <p className="hint" style={{ marginTop: 0 }}>
              {part.electrical.voltage && (
                <>
                  {t('Runs on ')}
                  {part.electrical.voltage.join(' or ')}
                  {t(' V. ')}
                </>
              )}
              {part.electrical.currentPeak != null && (
                <>
                  {t('Draws up to ')}
                  {part.electrical.currentPeak}
                  {t(' A. ')}
                </>
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
          <label>{t('Name')}</label>
          <input
            value={body.name}
            onChange={(e) => store.updateBody(id, { name: e.target.value })}
          />
        </div>
        {size && mesh && (
          <p className="hint mono" style={{ marginTop: 8 }}>
            {show(size[0])} × {show(size[1])} × {show(size[2])} {units}
            <br />
            {mesh.kind === 'mesh' && !mesh.watertight
              ? t('Open mesh, so it has no volume')
              : mesh.kind === 'surface'
                ? t('Surface body, so it has no volume')
                : t('{0} of material', volumeLabel(mesh.volume, units))}
          </p>
        )}
        {mesh?.kind === 'mesh' && (
          <p className="hint" style={{ marginTop: 0 }}>
            {t('Mesh body: ')}
            {(mesh.mesh.triangles.length / 3).toLocaleString()}
            {t(' triangles')}
            {mesh.pieces && mesh.pieces > 1 ? t(', {0} loose pieces', mesh.pieces) : ''}.{' '}
            {mesh.watertight
              ? t('Watertight.')
              : t('It has open edges; Repair closes small holes.')}
          </p>
        )}
        {mesh?.kind === 'solid' && !!mesh.pieces && mesh.pieces > 1 && (
          <p className="hint" style={{ marginTop: 0 }}>
            {mesh.pieces}
            {t(
              ' separate pieces that do not touch. Anything floating falls over when you print it.',
            )}
          </p>
        )}
      </div>

      <div className="section" hidden={mesh?.kind === 'mesh'}>
        <h3>{t('Quick actions')}</h3>
        {doc.timeline
          .filter((feature) => feature.kind === 'portCutout' && feature.bodyId === id)
          .map((feature) => (
            <label key={feature.id} className="sketch-option">
              <input
                type="checkbox"
                checked={!feature.suppressed}
                onChange={(e) => store.updateFeature(feature.id, { suppressed: !e.target.checked })}
              />
              {t('Port openings')}: {feature.name}
            </label>
          ))}
        {objectActions({ kind: 'body', id })
          .filter((a) =>
            (mesh?.kind === 'surface'
              ? ['size', 'move', 'turn', 'sketch-on-top']
              : ['size', 'move', 'turn', 'round', 'bevel', 'sketch-on-top']
            ).includes(a.id),
          )
          .map((action) => (
            <button key={action.id} className="btn" onClick={() => chooseAction(action)}>
              {t(action.label)}
              <small>{t(action.hint)}</small>
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
            {feature.sketch.entities.length}
            {t(' line')}
            {feature.sketch.entities.length === 1 ? '' : 's'}
            {t(' drawn.')}
          </p>
          <button className="btn primary" onClick={() => store.openSketch(featureId)}>
            {t('Edit this sketch')}
          </button>
        </>
      )}

      {feature.kind === 'joint' && <JointPanel key={feature.id} feature={feature} />}

      {feature.kind === 'jointOrigin' && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {t('A saved snap point on ')}
            {component?.name ?? t('a component')}
            {t('. Joints that use it follow it when it changes.')}
          </p>
          <button className="btn primary" onClick={() => editFeature(feature)}>
            {t('Edit Joint Origin')}
          </button>
        </>
      )}

      {feature.kind === 'rigidGroup' && (
        <p className="hint" style={{ marginTop: 0 }}>
          {t('Holds')}{' '}
          {feature.members
            .map((path) =>
              path.length
                ? (findOccurrence(doc, path[path.length - 1])?.name ?? 'a missing component')
                : doc.name || 'the top design',
            )
            .join(', ')}{' '}
          {t('together.')}
        </p>
      )}

      {feature.kind === 'motionStudy' && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {feature.tracks.length}
            {t(' joint')}
            {feature.tracks.length === 1 ? '' : 's'}
            {t(' over')} {counted(feature.steps, 'step')}.
          </p>
          <button className="btn primary" onClick={() => editFeature(feature)}>
            {t('Play and edit')}
          </button>
        </>
      )}

      {feature.kind === 'motionLink' && (
        <p className="hint" style={{ marginTop: 0 }}>
          {findFeature(doc, feature.a.jointId)?.name ?? t('A missing joint')}
          {t(' drives')} {findFeature(doc, feature.b.jointId)?.name ?? t('a missing joint')}
          {t(' at a ratio of')} {fmt(feature.ratio)}.
        </p>
      )}

      {feature.kind === 'extrude' && (
        <>
          <Num
            label={t('Thickness')}
            value={feature.distance}
            onChange={(v) => {
              if (v) patch({ distance: v } as Partial<Feature>)
            }}
          />
          <div className="row">
            <label>{t('Direction')}</label>
            <select
              value={feature.reverse ? 'down' : 'up'}
              onChange={(e) => patch({ reverse: e.target.value === 'down' } as Partial<Feature>)}
            >
              <option value="up">{t('Upwards')}</option>
              <option value="down">{t('Downwards')}</option>
            </select>
          </div>
          <div className="row">
            <label title={t('New Body, Join or Cut')}>{t('Operation')}</label>
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
              <option value="new">{t('New Body')}</option>
              {component?.bodies
                .filter((b) => feature.result.kind !== 'newBody' || b.id !== feature.result.bodyId)
                .flatMap((b) => [
                  <option key={`join:${b.id}`} value={`join:${b.id}`}>
                    {t('Join to ')}
                    {b.name}
                  </option>,
                  <option key={`cut:${b.id}`} value={`cut:${b.id}`}>
                    {t('Cut ')}
                    {b.name}
                  </option>,
                ])}
            </select>
          </div>
        </>
      )}

      {feature.kind === 'revolve' && (
        <>
          <Num
            label={t('How far round')}
            value={feature.angle}
            step={15}
            min={1}
            suffix="°"
            onChange={(v) => patch({ angle: Math.min(360, v) } as Partial<Feature>)}
          />
          <div className="row">
            <label>{t('Spin about')}</label>
            <select
              value={feature.axis}
              onChange={(e) => patch({ axis: e.target.value } as Partial<Feature>)}
            >
              <option value="x">{t('The sideways axis')}</option>
              <option value="y">{t('The upright axis')}</option>
            </select>
          </div>
          <p className="hint">
            {t(
              'Draw the outline to one side of the axis, not across it, or it will try to pass through itself.',
            )}
          </p>
        </>
      )}

      {feature.kind === 'sphere' && (
        <>
          <Num
            label={t('Radius')}
            value={feature.radius}
            min={0.1}
            onChange={(v) => patch({ radius: v } as Partial<Feature>)}
          />
          <div className="row">
            <label>{t('Shape')}</label>
            <select
              value={feature.half ? 'half' : 'full'}
              onChange={(e) => patch({ half: e.target.value === 'half' } as Partial<Feature>)}
            >
              <option value="full">{t('A whole ball')}</option>
              <option value="half">{t('A dome, flat side down')}</option>
            </select>
          </div>
        </>
      )}

      {feature.kind === 'vent' && (
        <>
          <div className="row">
            <label>{t('Hole shape')}</label>
            <select
              value={feature.shape}
              onChange={(e) => patch({ shape: e.target.value } as Partial<Feature>)}
            >
              <option value="hex">{t('Hexagons')}</option>
              <option value="round">{t('Round')}</option>
              <option value="square">{t('Square')}</option>
            </select>
          </div>
          <Num
            label={feature.shape === 'hex' ? t('Across flats') : t('Hole size')}
            value={feature.size}
            step={0.5}
            min={0.2}
            onChange={(v) => patch({ size: v } as Partial<Feature>)}
          />
          <Num
            label={t('Gap between')}
            value={feature.spacing}
            step={0.2}
            min={0.2}
            onChange={(v) => patch({ spacing: v } as Partial<Feature>)}
          />
          <Num
            label={t('Edge border')}
            value={feature.margin}
            step={0.5}
            min={0}
            onChange={(v) => patch({ margin: v } as Partial<Feature>)}
          />
          <p className="hint">
            {t(
              'The border is solid material left all the way round, so the grid never runs off the edge and leaves slivers that snap off.',
            )}
          </p>
        </>
      )}

      {feature.kind === 'lid' && (
        <>
          <Num
            label={t('Thickness')}
            value={feature.thickness}
            min={0.2}
            onChange={(v) => patch({ thickness: v } as Partial<Feature>)}
          />
          <p className="hint">
            {t(
              'A separate body, so you can hide it to see inside, vent it, or export it on its own.',
            )}
          </p>
        </>
      )}

      {feature.kind === 'hole' && (
        <>
          <div className="row">
            <label>{t('Type')}</label>
            <select
              value={feature.style}
              onChange={(e) => patch({ style: e.target.value } as Partial<Feature>)}
            >
              <option value="simple">{t('Plain hole')}</option>
              <option value="counterbore">{t('Counterbored (screw head sits flush)')}</option>
              <option value="countersink">{t('Countersunk (for a tapered head)')}</option>
            </select>
          </div>
          <Num
            label={t('Hole size')}
            value={feature.diameter}
            step={0.1}
            min={0.5}
            onChange={(v) => patch({ diameter: v } as Partial<Feature>)}
          />
          {feature.style !== 'simple' && (
            <>
              <Num
                label={t('Head size')}
                value={feature.counterboreDiameter ?? feature.diameter * 2}
                step={0.1}
                onChange={(v) => patch({ counterboreDiameter: v } as Partial<Feature>)}
              />
              {feature.style === 'counterbore' && (
                <Num
                  label={t('Head depth')}
                  value={feature.counterboreDepth ?? 2}
                  step={0.1}
                  onChange={(v) => patch({ counterboreDepth: v } as Partial<Feature>)}
                />
              )}
            </>
          )}
          <div className="row">
            <label>{t('Depth')}</label>
            <select
              value={feature.depth === 'through' ? 'through' : 'blind'}
              onChange={(e) =>
                patch({ depth: e.target.value === 'through' ? 'through' : 5 } as Partial<Feature>)
              }
            >
              <option value="through">{t('All the way through')}</option>
              <option value="blind">{t('A set depth')}</option>
            </select>
          </div>
          {feature.depth !== 'through' && (
            <Num
              label={t('Deep')}
              value={feature.depth}
              onChange={(v) => patch({ depth: v } as Partial<Feature>)}
            />
          )}
          {feature.source.kind === 'occurrence' && (
            <p className="hint">
              {t(
                'These follow the part they were made for. Move the board and the holes move with it.',
              )}
            </p>
          )}
        </>
      )}

      {feature.kind === 'standoff' && (
        <>
          <Num
            label={t('Height')}
            value={feature.height}
            min={0.5}
            onChange={(v) => patch({ height: v } as Partial<Feature>)}
          />
          <Num
            label={t('Pillar size')}
            value={feature.outerDiameter}
            step={0.5}
            onChange={(v) => patch({ outerDiameter: v } as Partial<Feature>)}
          />
          <Num
            label={t('Screw hole')}
            value={feature.boreDiameter}
            step={0.1}
            onChange={(v) => patch({ boreDiameter: v } as Partial<Feature>)}
          />
          <Num
            label={t('Hole depth')}
            value={feature.boreDepth}
            step={0.5}
            onChange={(v) => patch({ boreDepth: v } as Partial<Feature>)}
          />
          <p className="hint">
            {t(
              "For a self-tapping screw make the hole about 0.4 mm under the screw size. For a brass heat-set insert, use the insert's recommended hole instead.",
            )}
          </p>
        </>
      )}

      {feature.kind === 'portCutout' && (
        <>
          <label className="sketch-option">
            <input
              type="checkbox"
              checked={!feature.suppressed}
              onChange={(e) => patch({ suppressed: !e.target.checked })}
            />
            {t('Port openings')}
          </label>
          <Num
            label={t('Extra room')}
            value={feature.tolerance}
            step={0.1}
            onChange={(v) => patch({ tolerance: v } as Partial<Feature>)}
          />
          <p className="hint">
            {t(
              'Added all the way round each opening. 0.5 mm is usually enough for a printed wall; go bigger if your printer runs wide.',
            )}
          </p>
        </>
      )}

      {feature.kind === 'fillet' && (
        <Num
          label={t('Radius')}
          value={feature.radius}
          min={0.1}
          onChange={(v) => patch({ radius: v } as Partial<Feature>)}
        />
      )}
      {feature.kind === 'chamfer' && (
        <Num
          label={t('Size')}
          value={feature.distance}
          min={0.1}
          onChange={(v) => patch({ distance: v } as Partial<Feature>)}
        />
      )}
      {feature.kind === 'shell' && (
        <Num
          label={t('Wall')}
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
      <h3>{t('Picked on the shape')}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {parts.join(', ')}
        {t(' selected. Shift-click to add more, then use Actions for what you can do with them.')}
      </p>
      <button className="btn" onClick={() => useStore.getState().setSubSelection([])}>
        {t('Clear the selection')}
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
        <h3>{t('This sketch')}</h3>
        {status && (
          <p className="hint" style={{ marginTop: 0 }}>
            {status.failing.length > 0
              ? t('Some of the sizes you have set contradict each other.')
              : status.dof === 0
                ? t('Fully defined. Nothing can move by accident.')
                : t(
                    '{0} thing{1} can still move. Set more sizes to lock it down.',
                    status.dof,
                    status.dof === 1 ? '' : 's',
                  )}
          </p>
        )}
      </div>

      {selection.length === 0 ? (
        <div className="section">
          <h3>{t('Nothing picked')}</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              'Click a line, a circle or a corner. Shift-click to add a second one. Available dimensions and constraints appear here.',
            )}
          </p>
        </div>
      ) : (
        <div className="section">
          <h3>
            {entity
              ? entity.kind === 'line'
                ? t('Line')
                : entity.kind === 'circle'
                  ? t('Circle')
                  : t('Arc')
              : single?.kind === 'point'
                ? t('Corner')
                : t('{0} things picked', selection.length)}
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
                    label={t('Length')}
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
                    {t('runs at ')}
                    {fmt(angle, 1)}
                    {t('° from horizontal')}
                  </p>
                </>
              )
            })()}

          {entity?.kind === 'circle' && (
            <Num
              label={t('Diameter')}
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
                  {t('at ')}
                  {lengthLabel(p.x, units, false)}, {lengthLabel(p.y, units)}
                </p>
              ) : null
            })()}

          {actions.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>{t('What you can do')}</h3>
              <FlyoutMenu actions={actions} onPick={chooseSketchAction} />
            </>
          )}
        </div>
      )}
    </>
  )
}
