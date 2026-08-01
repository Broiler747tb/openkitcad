import { useMemo, useState } from 'react'
import { useStore } from '../doc/store'
import { FEATURE_ICON, FEATURE_LABEL, type Body, type Feature } from '../doc/types'
import { PartMaker } from './PartMaker'
import {
  groupedCatalogue,
  searchParts,
  CATEGORY_BLURB,
  CONFIDENCE_LABEL,
} from '../catalogue'

export function LeftPanel() {
  const [tab, setTab] = useState<'design' | 'catalogue'>('design')
  return (
    <div className="panel-left">
      <div className="tabs">
        <button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>
          Design
        </button>
        <button className={tab === 'catalogue' ? 'active' : ''} onClick={() => setTab('catalogue')}>
          Parts catalogue
        </button>
      </div>
      {tab === 'design' ? <DesignTree /> : <Catalogue />}
    </div>
  )
}

function DesignTree() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const errors = useStore((s) => s.errors)
  const store = useStore.getState()

  const errorFeatures = useMemo(
    () => new Set(errors.map((e) => e.featureId)),
    [errors],
  )

  if (doc.bodies.length === 0 && doc.placements.length === 0) {
    return (
      <div className="empty">
        Nothing here yet.
        <br />
        <br />
        Press <strong>New sketch</strong> to draw a shape and turn it into a solid, or open the{' '}
        <strong>Parts catalogue</strong> and drop in a board to build around.
      </div>
    )
  }

  return (
    <div className="tree">
      {doc.bodies.map((body) => (
        <BodyBranch
          key={body.id}
          body={body}
          selection={selection}
          errorFeatures={errorFeatures}
        />
      ))}

      {doc.placements.length > 0 && (
        <>
          <div className="tree-item tree-body" style={{ marginTop: 14 }}>
            <span className="glyph">▦</span>
            <span className="name">Parts from the catalogue</span>
          </div>
          {doc.placements.map((placement) => (
            <div
              key={placement.id}
              className={`tree-item tree-feature ${
                selection.id === placement.id ? 'selected' : ''
              }`}
              onClick={() => store.select({ kind: 'placement', id: placement.id })}
              onMouseEnter={() => store.setHovered(placement.id)}
              onMouseLeave={() => store.setHovered(null)}
            >
              <span className="glyph">▪</span>
              <span className="name">{placement.name}</span>
              <button
                className="act"
                title={placement.visible ? 'Hide' : 'Show'}
                onClick={(e) => {
                  e.stopPropagation()
                  store.updatePlacement(placement.id, { visible: !placement.visible })
                }}
              >
                {placement.visible ? '◉' : '○'}
              </button>
              <button
                className="act"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation()
                  store.removePlacement(placement.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function BodyBranch({
  body,
  selection,
  errorFeatures,
}: {
  body: Body
  selection: ReturnType<typeof useStore.getState>['selection']
  errorFeatures: Set<string>
}) {
  const store = useStore.getState()
  return (
    <>
      <div
        className={`tree-item tree-body ${selection.id === body.id ? 'selected' : ''}`}
        onClick={() => store.select({ kind: 'body', id: body.id })}
        onMouseEnter={() => store.setHovered(body.id)}
        onMouseLeave={() => store.setHovered(null)}
      >
        <span className="glyph">▣</span>
        <span className="name">{body.name}</span>
        <button
          className="act"
          title={body.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            store.commit((d) => {
              const b = d.bodies.find((x) => x.id === body.id)
              if (b) b.visible = !b.visible
            })
          }}
        >
          {body.visible ? '◉' : '○'}
        </button>
        <button
          className="act"
          title="Delete this part"
          onClick={(e) => {
            e.stopPropagation()
            store.removeBody(body.id)
          }}
        >
          ✕
        </button>
      </div>

      {body.features.map((feature) => (
        <FeatureRow
          key={feature.id}
          bodyId={body.id}
          feature={feature}
          selected={selection.id === feature.id}
          failed={errorFeatures.has(feature.id)}
        />
      ))}
    </>
  )
}

function FeatureRow({
  bodyId,
  feature,
  selected,
  failed,
}: {
  bodyId: string
  feature: Feature
  selected: boolean
  failed: boolean
}) {
  const store = useStore.getState()
  return (
    <div
      className={`tree-item tree-feature ${selected ? 'selected' : ''} ${failed ? 'error' : ''}`}
      onClick={() => store.select({ kind: 'feature', id: feature.id, bodyId })}
      onDoubleClick={() => {
        if (feature.kind === 'sketch') store.openSketch(bodyId, feature.id)
      }}
      title={feature.kind === 'sketch' ? 'Double-click to edit this sketch' : undefined}
    >
      <span className="glyph">{FEATURE_ICON[feature.kind]}</span>
      <span className="name" style={{ opacity: feature.suppressed ? 0.45 : 1 }}>
        {feature.name || FEATURE_LABEL[feature.kind]}
      </span>
      <button
        className="act"
        title="Move earlier"
        onClick={(e) => {
          e.stopPropagation()
          store.moveFeature(bodyId, feature.id, -1)
        }}
      >
        ↑
      </button>
      <button
        className="act"
        title={feature.suppressed ? 'Turn this step back on' : 'Turn this step off'}
        onClick={(e) => {
          e.stopPropagation()
          store.updateFeature(bodyId, feature.id, { suppressed: !feature.suppressed })
        }}
      >
        {feature.suppressed ? '○' : '◉'}
      </button>
      <button
        className="act"
        title="Delete this step"
        onClick={(e) => {
          e.stopPropagation()
          store.removeFeature(bodyId, feature.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

function Catalogue() {
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState(false)
  // Bumped when a part is added, so the list picks it up.
  const [version, setVersion] = useState(0)
  const groups = useMemo(() => groupedCatalogue(searchParts(query)), [query, version])

  return (
    <>
      {making && (
        <PartMaker
          onClose={() => {
            setMaking(false)
            setVersion((v) => v + 1)
          }}
        />
      )}
      <div className="cat-search">
        <input
          placeholder="Search parts, e.g. pi, m3, nema"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <button className="btn cat-add" onClick={() => setMaking(true)}>
          Add a part that isn't here
          <small>Measure it once, use it straight away, send it in if you like</small>
        </button>
        {groups.length === 0 && (
          <div className="empty">
            Nothing matches that.
            <br />
            <br />
            The catalogue is open source, and if a part you use is missing you can measure
            it yourself in a couple of minutes.
            <br />
            <br />
            <button className="btn" onClick={() => setMaking(true)}>
              Add a part that isn't here
            </button>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.category}>
            <div className="cat-group">{group.label}</div>
            <div className="cat-blurb">{CATEGORY_BLURB[group.category]}</div>
            {group.parts.map((part) => (
              <button
                key={part.id}
                className="cat-item"
                title={`${CONFIDENCE_LABEL[part.confidence]}\n\n${part.source}`}
                onClick={() => useStore.getState().addPlacement(part.id)}
              >
                <strong>
                  {part.name}
                  {part.confidence === 'approximate' && (
                    <span style={{ color: 'var(--warn)', marginLeft: 6, fontSize: 10 }}>
                      approx
                    </span>
                  )}
                </strong>
                <span>{part.summary}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
