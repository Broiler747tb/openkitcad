import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  allParts,
  catalogueEntries,
  CATEGORY_BLURB,
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  getPart,
  groupedEntries,
  isUserPart,
  matchesFilters,
  searchEntries,
  type CatalogueEntry,
  type CataloguePart,
  type PartCategory,
} from '../../catalogue'
import { PartMaker } from '../PartMaker'
import { endPartDrag, placePart, startPartDrag } from './actions'
import { PartDetails } from './PartDetails'
import { PartSketch } from './PartSketch'
import { usePartsView, useShelf } from './shelf'
import { VariantPicker } from './VariantPicker'
import { YourParts } from './YourParts'
import './parts.css'

export const CATEGORY_SHORT: Record<PartCategory, string> = {
  sbc: 'Computers',
  mcu: 'Microcontrollers',
  connector: 'Connectors',
  display: 'Displays',
  sensor: 'Sensors',
  power: 'Power',
  fastener: 'Fasteners',
  extrusion: 'Extrusion',
  motor: 'Motors',
  motion: 'Bearings',
  control: 'Controls',
}

export function entryCategory(entry: CatalogueEntry): PartCategory {
  return entry.kind === 'part' ? entry.part.category : entry.family.category
}

export function PartsPanel() {
  const version = useShelf((s) => s.version)
  const query = usePartsView((s) => s.query)
  const filters = usePartsView((s) => s.filters)
  const view = usePartsView((s) => s.view)
  const maker = usePartsView((s) => s.maker)
  const parts = useMemo(() => allParts(), [version])
  const input = useRef<HTMLInputElement>(null)
  const { setQuery, setFilters, show, openMaker } = usePartsView.getState()
  const searching = query.trim().length > 0 && view.kind !== 'details' && view.kind !== 'mine'
  const filtering = !!(filters.official || filters.mountingHoles)
  const makerBase = maker?.partId ? getPart(maker.partId) : undefined

  return (
    <div className="parts-panel">
      {maker && <PartMaker mode={maker.mode} base={makerBase} onClose={() => openMaker(null)} />}
      <VariantPicker />
      <div className="parts-head">
        <div className="parts-search">
          <input
            ref={input}
            value={query}
            aria-label="Search parts"
            placeholder={`Search ${parts.length} parts: pi, usb-c, m3…`}
            onChange={(e) => {
              setQuery(e.target.value)
              if (view.kind !== 'home') show({ kind: 'home' })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
          {query && (
            <button
              className="parts-clear"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                setQuery('')
                input.current?.focus()
              }}
            >
              ×
            </button>
          )}
        </div>
        <div className="parts-chips" role="group" aria-label="Filters">
          <Chip
            on={!!filters.official}
            title="Only parts whose sizes come from a published drawing or were measured"
            onClick={() => setFilters({ ...filters, official: !filters.official })}
          >
            Verified sizes
          </Chip>
          <Chip
            on={!!filters.mountingHoles}
            title="Only parts with mounting holes you can screw through"
            onClick={() => setFilters({ ...filters, mountingHoles: !filters.mountingHoles })}
          >
            Mounting holes
          </Chip>
        </div>
      </div>
      <div className="parts-body">
        {view.kind === 'details' ? (
          <PartDetails partId={view.partId} back={view.back} />
        ) : view.kind === 'mine' ? (
          <YourParts />
        ) : searching ? (
          <SearchResults key={query} parts={parts} />
        ) : view.kind === 'type' ? (
          <TypeList category={view.category} parts={parts} />
        ) : filtering ? (
          <Filtered parts={parts} />
        ) : (
          <Home parts={parts} />
        )}
      </div>
    </div>
  )
}

function Chip({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`parts-chip ${on ? 'on' : ''}`}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Home({ parts }: { parts: CataloguePart[] }) {
  const favourites = useShelf((s) => s.favourites)
  const recent = useShelf((s) => s.recent)
  const show = usePartsView((s) => s.show)
  const openMaker = usePartsView((s) => s.openMaker)
  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts])
  const shelf = (ids: string[]) =>
    ids.flatMap((id) => {
      const part = byId.get(id)
      return part ? [part] : []
    })
  const favouriteParts = shelf(favourites)
  const recentParts = shelf(recent)
  const popular = useMemo(() => catalogueEntries(parts).slice(0, 6), [parts])
  const groups = useMemo(() => groupedEntries(parts), [parts])
  const mine = parts.filter((part) => isUserPart(part.id)).length

  return (
    <>
      {favouriteParts.length > 0 && (
        <section className="parts-section">
          <h4>Favourites</h4>
          {favouriteParts.map((part) => (
            <PartRow key={part.id} part={part} />
          ))}
        </section>
      )}
      {recentParts.length > 0 && (
        <section className="parts-section">
          <h4>Recently used</h4>
          {recentParts.map((part) => (
            <PartRow key={part.id} part={part} />
          ))}
        </section>
      )}
      <section className="parts-section">
        <h4>Popular</h4>
        {popular.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </section>
      <section className="parts-section">
        <h4>Browse by type</h4>
        {groups.map((group) => (
          <button
            key={group.category}
            className="parts-type"
            title={CATEGORY_BLURB[group.category]}
            onClick={() => show({ kind: 'type', category: group.category })}
          >
            <strong>{group.label}</strong>
            <span className="parts-count">{group.count}</span>
            <span className="parts-arrow">›</span>
          </button>
        ))}
      </section>
      <section className="parts-section">
        <h4>Your parts</h4>
        <button className="parts-type" onClick={() => show({ kind: 'mine' })}>
          <strong>Manage your parts</strong>
          <span className="parts-count">{mine}</span>
          <span className="parts-arrow">›</span>
        </button>
        <button className="btn parts-make" onClick={() => openMaker({ mode: 'new' })}>
          Add a part that isn't here
          <small>Measure it once and use it straight away</small>
        </button>
      </section>
    </>
  )
}

function SearchResults({ parts }: { parts: CataloguePart[] }) {
  const query = usePartsView((s) => s.query)
  const filters = usePartsView((s) => s.filters)
  const openMaker = usePartsView((s) => s.openMaker)
  const [only, setOnly] = useState<PartCategory | null>(null)
  const entries = useMemo(() => searchEntries(parts, query, filters), [parts, query, filters])
  const counts = useMemo(() => {
    const out = new Map<PartCategory, number>()
    for (const entry of entries)
      out.set(entryCategory(entry), (out.get(entryCategory(entry)) ?? 0) + 1)
    return out
  }, [entries])
  const shown = only ? entries.filter((entry) => entryCategory(entry) === only) : entries

  if (!entries.length)
    return (
      <div className="parts-empty">
        <strong>Nothing matches “{query.trim()}”.</strong>
        <span>
          Try a shorter word, or turn off the filters. If a part you use is missing, you can measure
          it in a couple of minutes.
        </span>
        <button className="btn" onClick={() => openMaker({ mode: 'new' })}>
          Add a part that isn't here
        </button>
      </div>
    )

  return (
    <>
      {counts.size > 1 && (
        <div className="parts-chips parts-types" role="group" aria-label="Narrow by type">
          <Chip on={!only} onClick={() => setOnly(null)}>
            All {entries.length}
          </Chip>
          {[...counts].map(([category, count]) => (
            <Chip
              key={category}
              on={only === category}
              title={CATEGORY_LABEL[category]}
              onClick={() => setOnly(only === category ? null : category)}
            >
              {CATEGORY_SHORT[category]} {count}
            </Chip>
          ))}
        </div>
      )}
      {shown.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </>
  )
}

function TypeList({ category, parts }: { category: PartCategory; parts: CataloguePart[] }) {
  const filters = usePartsView((s) => s.filters)
  const show = usePartsView((s) => s.show)
  const entries = useMemo(
    () =>
      catalogueEntries(
        parts.filter((part) => part.category === category && matchesFilters(part, filters)),
      ),
    [parts, category, filters],
  )
  return (
    <>
      <button className="parts-back" onClick={() => show({ kind: 'home' })}>
        ‹ All parts
      </button>
      <div className="parts-heading">
        <strong>{CATEGORY_LABEL[category]}</strong>
        <span>{CATEGORY_BLURB[category]}</span>
      </div>
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
      {!entries.length && (
        <div className="parts-empty">
          <span>No parts of this type pass the filters.</span>
        </div>
      )}
    </>
  )
}

function Filtered({ parts }: { parts: CataloguePart[] }) {
  const filters = usePartsView((s) => s.filters)
  const groups = useMemo(
    () => groupedEntries(parts.filter((part) => matchesFilters(part, filters))),
    [parts, filters],
  )
  return (
    <>
      {groups.map((group) => (
        <section key={group.category} className="parts-section">
          <h4>{group.label}</h4>
          {group.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </section>
      ))}
      {!groups.length && (
        <div className="parts-empty">
          <span>No parts pass these filters.</span>
        </div>
      )}
    </>
  )
}

export function EntryRow({ entry }: { entry: CatalogueEntry }) {
  return entry.kind === 'part' ? <PartRow part={entry.part} /> : <FamilyRow entry={entry} />
}

export function PartRow({ part }: { part: CataloguePart }) {
  const favourite = useShelf((s) => s.favourites.includes(part.id))
  return (
    <div
      className="parts-row"
      draggable
      onDragStart={(e) => startPartDrag(e, part.id)}
      onDragEnd={endPartDrag}
    >
      <button
        className="parts-row-main"
        title={`${part.name}
${part.summary}

Click for details, or drag it onto a face in the view.`}
        onClick={() => {
          const { view, show } = usePartsView.getState()
          show({ kind: 'details', partId: part.id, back: view })
        }}
      >
        <PartSketch part={part} className="parts-thumb" />
        <span className="parts-row-text">
          <strong>
            {favourite && (
              <span className="parts-starred" aria-label="Favourite">
                ★
              </span>
            )}
            {part.name}
          </strong>
          <span>
            {isUserPart(part.id) && <span className="parts-tag">yours</span>}
            {part.confidence === 'approximate' && (
              <span className="parts-tag warn" title={CONFIDENCE_LABEL.approximate}>
                approx
              </span>
            )}
            {part.summary}
          </span>
        </span>
      </button>
      <span className="parts-row-actions">
        <button
          className={`parts-star ${favourite ? 'on' : ''}`}
          aria-pressed={favourite}
          aria-label={
            favourite ? `Remove ${part.name} from favourites` : `Add ${part.name} to favourites`
          }
          title={favourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => useShelf.getState().toggleFavourite(part.id)}
        >
          {favourite ? '★' : '☆'}
        </button>
        <button
          className="parts-add"
          aria-label={`Insert ${part.name}`}
          title="Insert at the origin"
          onClick={() => placePart(part.id)}
        >
          ＋
        </button>
      </span>
    </div>
  )
}

function FamilyRow({ entry }: { entry: Extract<CatalogueEntry, { kind: 'family' }> }) {
  const top = entry.parts[0]
  return (
    <div
      className="parts-row family"
      draggable
      onDragStart={(e) => startPartDrag(e, top.id)}
      onDragEnd={endPartDrag}
    >
      <button
        className="parts-row-main"
        aria-label={`${entry.name}: choose one of ${entry.parts.length} versions`}
        title={`${entry.name}
${entry.family.summary}

Click to choose a version. Dragging places the most common one, ${top.variant ?? top.name}.`}
        onClick={() => usePartsView.getState().openPicker(entry.id)}
      >
        <span className="parts-thumb-stack">
          <PartSketch part={top} className="parts-thumb" />
        </span>
        <span className="parts-row-text">
          <strong>{entry.name}</strong>
          <span>
            <span className="parts-versions">{entry.parts.length} versions</span>
            {entry.family.summary}
          </span>
        </span>
        <span className="parts-arrow">›</span>
      </button>
    </div>
  )
}
