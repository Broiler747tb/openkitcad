import { useMemo } from 'react'
import { editFeature } from './command/commands'
import {
  bodyPick,
  featurePick,
  occurrencePick,
  offerPick,
  planePick,
  sketchPick,
} from './command/picks'
import { setGrounded } from './command/specs/assemble'
import { useStore } from '../doc/store'
import {
  FEATURE_ICON,
  FEATURE_LABEL,
  type Body,
  type Component,
  type Feature,
  type LengthUnit,
  type Occurrence,
} from '../doc/types'
import {
  canMoveFeature,
  childOccurrences,
  featureCreatesBodies,
  featureIndex,
  featureModifiesBodies,
  findComponent,
  isRolledBack,
} from '../doc/model'
import { LENGTH_UNITS, UNIT_NAME } from '../core/units'
import { PartsPanel } from './parts/PartsPanel'

export function LeftPanel({
  tab,
  onTab: setTab,
}: {
  tab: 'design' | 'catalogue'
  onTab: (tab: 'design' | 'catalogue') => void
}) {
  return (
    <div className={`panel-left ${tab === 'catalogue' ? 'parts-open' : ''}`}>
      <div className="panel-caption">
        BROWSER <span>▾</span>
      </div>
      <div className="tabs">
        <button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>
          Design
        </button>
        <button className={tab === 'catalogue' ? 'active' : ''} onClick={() => setTab('catalogue')}>
          Components
        </button>
      </div>
      {tab === 'design' ? <DesignTree /> : <PartsPanel />}
    </div>
  )
}

function DesignTree() {
  const doc = useStore((s) => s.doc)
  const errors = useStore((s) => s.errors)
  const failed = useMemo(
    () => new Set(errors.filter((e) => e.severity === 'error').map((e) => e.featureId)),
    [errors],
  )
  const root = findComponent(doc, doc.rootComponentId)
  const store = useStore.getState()

  return (
    <div className="tree">
      <DocumentSettings name={doc.name} units={doc.units} />
      <details className="origin-planes">
        <summary>▱ Origin</summary>
        {(['XY', 'XZ', 'YZ'] as const).map((name) => (
          <button
            key={name}
            title={`Use the ${name} plane in the open command, or sketch on it`}
            onClick={() => {
              const plane = { kind: 'named', name, offset: 0 } as const
              if (offerPick(planePick(doc, plane))) return
              store.startSketch(plane)
            }}
          >
            ▧ {name} Plane
          </button>
        ))}
      </details>
      {root && <ComponentContents component={root} failed={failed} lineage={[root.id]} />}
      {!doc.timeline.length && !doc.occurrences.length && (
        <div className="empty">
          Create Sketch → choose a plane → draw a profile → Finish Sketch → Extrude (E). Insert
          hardware from the toolbar to build around a component.
        </div>
      )}
    </div>
  )
}

function DocumentSettings({ name, units }: { name: string; units: LengthUnit }) {
  return (
    <details className="document-settings">
      <summary className="browser-document">
        ◈ {name} <small>{units}</small>
      </summary>
      <label
        className="browser-setting"
        title="Lengths are shown and typed in this unit. The design is stored in millimetres."
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px' }}
      >
        <span>Units</span>
        <select
          aria-label="Document units"
          value={units}
          onChange={(e) => useStore.getState().setUnits(e.target.value as LengthUnit)}
        >
          {LENGTH_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_NAME[unit]} ({unit})
            </option>
          ))}
        </select>
      </label>
    </details>
  )
}

function ComponentContents({
  component,
  failed,
  lineage,
}: {
  component: Component
  failed: Set<string>
  lineage: string[]
}) {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const instances = useStore((s) => s.instances)
  const meshes = useStore((s) => s.meshes)
  const bodyKinds = new Map(
    instances.flatMap((instance) => {
      const kind = meshes.get(instance.meshKey)?.kind
      return instance.bodyId && kind ? [[instance.bodyId, kind] as const] : []
    }),
  )
  const meshBodyIds = new Set(
    [...bodyKinds].filter(([, kind]) => kind === 'mesh').map(([bodyId]) => bodyId),
  )
  const solidBodies = component.bodies.filter((body) => !meshBodyIds.has(body.id))
  const meshBodies = component.bodies.filter((body) => meshBodyIds.has(body.id))
  const sketches = doc.timeline.filter(
    (feature) => feature.kind === 'sketch' && feature.componentId === component.id,
  )
  const children = childOccurrences(doc, component.id).filter(
    (occurrence) => !lineage.includes(occurrence.componentId),
  )
  const planes = doc.timeline.filter(
    (feature) => feature.kind === 'constructionPlane' && feature.componentId === component.id,
  )
  const origins = doc.timeline.filter(
    (feature) =>
      feature.kind === 'jointOrigin' &&
      (feature.componentId === component.id ||
        (component.id === doc.rootComponentId &&
          findComponent(doc, feature.componentId)?.source.kind === 'catalogue')),
  )
  const studies =
    component.id === doc.rootComponentId
      ? doc.timeline.filter((feature) => feature.kind === 'motionStudy')
      : []
  const joints = doc.timeline.filter(
    (feature) =>
      (feature.kind === 'joint' ||
        feature.kind === 'rigidGroup' ||
        feature.kind === 'motionLink') &&
      feature.componentId === component.id,
  )

  return (
    <>
      {solidBodies.length > 0 && (
        <details className="browser-folder" open>
          <summary>Bodies ({solidBodies.length})</summary>
          {solidBodies.map((body) => (
            <BodyBranch
              key={body.id}
              body={body}
              failed={failed}
              surface={bodyKinds.get(body.id) === 'surface'}
            />
          ))}
        </details>
      )}
      {meshBodies.length > 0 && (
        <details className="browser-folder" open>
          <summary>Mesh Bodies ({meshBodies.length})</summary>
          {meshBodies.map((body) => (
            <BodyBranch key={body.id} body={body} failed={failed} />
          ))}
        </details>
      )}
      {sketches.length > 0 && (
        <details className="browser-folder">
          <summary>Sketches ({sketches.length})</summary>
          {sketches.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              selected={selection.kind === 'feature' && selection.id === feature.id}
              failed={failed.has(feature.id)}
            />
          ))}
        </details>
      )}
      {planes.length > 0 && (
        <details className="browser-folder" open>
          <summary>Construction ({planes.length})</summary>
          {planes.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              selected={selection.kind === 'feature' && selection.id === feature.id}
              failed={failed.has(feature.id)}
            />
          ))}
        </details>
      )}
      {origins.length > 0 && (
        <details className="browser-folder">
          <summary>Joint Origins ({origins.length})</summary>
          {origins.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              selected={selection.kind === 'feature' && selection.id === feature.id}
              failed={failed.has(feature.id)}
            />
          ))}
        </details>
      )}
      {joints.length > 0 && (
        <details className="browser-folder" open>
          <summary>Joints ({joints.length})</summary>
          {joints.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              selected={selection.kind === 'feature' && selection.id === feature.id}
              failed={failed.has(feature.id)}
            />
          ))}
        </details>
      )}
      {studies.length > 0 && (
        <details className="browser-folder">
          <summary>Motion Studies ({studies.length})</summary>
          {studies.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              selected={selection.kind === 'feature' && selection.id === feature.id}
              failed={failed.has(feature.id)}
            />
          ))}
        </details>
      )}
      {children.map((occurrence) => (
        <OccurrenceBranch
          key={occurrence.id}
          occurrence={occurrence}
          failed={failed}
          lineage={lineage}
        />
      ))}
    </>
  )
}

function OccurrenceBranch({
  occurrence,
  failed,
  lineage,
}: {
  occurrence: Occurrence
  failed: Set<string>
  lineage: string[]
}) {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const activeComponentId = useStore((s) => s.activeComponentId)
  const store = useStore.getState()
  const component = findComponent(doc, occurrence.componentId)
  if (!component) return null
  const catalogue = component.source.kind === 'catalogue'
  const active = activeComponentId === component.id
  const selected = selection.kind === 'occurrence' && selection.id === occurrence.id

  return (
    <div className="browser-occurrence">
      <div
        className={`tree-item tree-body ${selected ? 'selected' : ''}`}
        onClick={() => {
          if (offerPick(occurrencePick(store.doc, occurrence.id))) return
          store.select({ kind: 'occurrence', id: occurrence.id })
        }}
        onMouseEnter={() => store.setHovered(occurrence.id)}
        onMouseLeave={() => store.setHovered(null)}
      >
        {!catalogue && (
          <input
            type="radio"
            className="activate"
            aria-label={`Activate ${occurrence.name}`}
            title={active ? 'Active component: new sketches and bodies go here' : 'Activate'}
            checked={active}
            onClick={(e) => e.stopPropagation()}
            onChange={() => store.activateComponent(component.id)}
          />
        )}
        <span className="glyph">{catalogue ? '▪' : '▦'}</span>
        <span className="name" style={{ opacity: occurrence.visible ? 1 : 0.45 }}>
          {occurrence.name}
        </span>
        <button
          className="act"
          title={
            occurrence.grounded
              ? 'Grounded: joints move the other components. Click to unground.'
              : 'Ground: pin it in place so joints move the other components'
          }
          aria-pressed={occurrence.grounded}
          style={{ opacity: occurrence.grounded ? 1 : 0.4 }}
          onClick={(e) => {
            e.stopPropagation()
            setGrounded(occurrence.id, !occurrence.grounded)
          }}
        >
          ⏚
        </button>
        <button
          className="act"
          title="Linked copy: shares this component's design"
          onClick={(e) => {
            e.stopPropagation()
            store.linkedCopy(occurrence.id)
          }}
        >
          ⧉
        </button>
        <button
          className="act"
          title={occurrence.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            store.updateOccurrence(occurrence.id, { visible: !occurrence.visible })
          }}
        >
          {occurrence.visible ? '◉' : '○'}
        </button>
        <button
          className="act"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            store.removeOccurrence(occurrence.id)
          }}
        >
          ✕
        </button>
      </div>
      {!catalogue && (
        <div className="browser-children" style={{ paddingLeft: 12 }}>
          <ComponentContents
            component={component}
            failed={failed}
            lineage={[...lineage, component.id]}
          />
        </div>
      )}
    </div>
  )
}

function BodyBranch({
  body,
  failed,
  surface,
}: {
  body: Body
  failed: Set<string>
  surface?: boolean
}) {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const store = useStore.getState()
  const steps = doc.timeline.filter(
    (feature) =>
      featureCreatesBodies(feature).includes(body.id) ||
      featureModifiesBodies(feature).includes(body.id),
  )

  return (
    <>
      <div
        className={`tree-item tree-body ${
          selection.kind === 'body' && selection.id === body.id ? 'selected' : ''
        }`}
        onClick={() => {
          if (offerPick(bodyPick(store.doc, body.id))) return
          store.select({ kind: 'body', id: body.id })
        }}
        onMouseEnter={() => store.setHovered(body.id)}
        onMouseLeave={() => store.setHovered(null)}
      >
        <span className="glyph" title={surface ? 'Surface body' : undefined}>
          {surface ? '▭' : '▣'}
        </span>
        <span className="name" style={{ opacity: body.visible ? 1 : 0.45 }}>
          {body.name}
        </span>
        <button
          className="act"
          title={body.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            store.updateBody(body.id, { visible: !body.visible })
          }}
        >
          {body.visible ? '◉' : '○'}
        </button>
        <button
          className="act"
          title="Delete this body and every step that builds it"
          onClick={(e) => {
            e.stopPropagation()
            store.removeBody(body.id)
          }}
        >
          ✕
        </button>
      </div>
      <details
        className="feature-history"
        open={
          selection.kind === 'feature' && steps.some((feature) => feature.id === selection.id)
            ? true
            : undefined
        }
      >
        <summary>
          {steps.length} modelling step{steps.length === 1 ? '' : 's'}
        </summary>
        {steps.map((feature) => (
          <FeatureRow
            key={feature.id}
            feature={feature}
            selected={selection.kind === 'feature' && selection.id === feature.id}
            failed={failed.has(feature.id)}
          />
        ))}
      </details>
    </>
  )
}

function FeatureRow({
  feature,
  selected,
  failed,
}: {
  feature: Feature
  selected: boolean
  failed: boolean
}) {
  const doc = useStore((s) => s.doc)
  const store = useStore.getState()
  const index = featureIndex(doc, feature.id)
  const dimmed = !!feature.suppressed || isRolledBack(doc, index)

  return (
    <div
      className={`tree-item tree-feature ${selected ? 'selected' : ''} ${failed ? 'error' : ''}`}
      onClick={() => {
        if (offerPick(sketchPick(doc, feature.id)) || offerPick(featurePick(doc, feature.id)))
          return
        if (
          feature.kind === 'constructionPlane' &&
          offerPick(planePick(doc, { kind: 'construction', featureId: feature.id, offset: 0 }))
        )
          return
        store.select({ kind: 'feature', id: feature.id })
      }}
      onDoubleClick={() => {
        if (feature.kind === 'sketch') store.openSketch(feature.id)
        else editFeature(feature)
      }}
      title={feature.kind === 'sketch' ? 'Double-click to edit this sketch' : undefined}
    >
      <span className="glyph">{FEATURE_ICON[feature.kind]}</span>
      <span className="name" style={{ opacity: dimmed ? 0.45 : 1 }}>
        {feature.name || FEATURE_LABEL[feature.kind]}
      </span>
      {(feature.kind === 'sketch' || feature.kind === 'constructionPlane') && (
        <button
          className="act"
          title={feature.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            store.updateFeature(feature.id, { visible: !feature.visible })
          }}
        >
          {feature.visible ? '◉' : '○'}
        </button>
      )}
      {feature.kind === 'sketch' && (
        <button
          className="act"
          title="Edit Sketch"
          onClick={(e) => {
            e.stopPropagation()
            store.openSketch(feature.id)
          }}
        >
          ✎
        </button>
      )}
      <button
        className="act"
        title="Move earlier in the timeline"
        disabled={index <= 0 || !canMoveFeature(doc, feature.id, index - 1)}
        onClick={(e) => {
          e.stopPropagation()
          store.moveFeature(feature.id, index - 1)
        }}
      >
        ↑
      </button>
      <button
        className="act"
        title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
        onClick={(e) => {
          e.stopPropagation()
          store.updateFeature(feature.id, { suppressed: !feature.suppressed })
        }}
      >
        {feature.suppressed ? '○' : '◉'}
      </button>
      <button
        className="act"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          if (store.removeFeature(feature.id)) return
          if (confirm(`Delete ${feature.name} and the steps that depend on it?`))
            store.removeFeature(feature.id, { withDependents: true })
        }}
      >
        ✕
      </button>
    </div>
  )
}
