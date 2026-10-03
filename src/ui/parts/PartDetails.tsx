import { t } from '../../i18n'
import { partSummary } from './translation'
import { Fragment, useMemo } from 'react'
import {
  allParts,
  byPopularity,
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  FAMILIES,
  getPart,
  isUserPart,
  partFacts,
  partToDraft,
} from '../../catalogue'
import { useStore } from '../../doc/store'
import { endPartDrag, placePart, startPartDrag } from './actions'
import { PartPreview } from './PartPicture'
import { usePartsView, useShelf, type PartsView } from './shelf'

export function PartDetails({ partId, back }: { partId: string; back: PartsView }) {
  const units = useStore((s) => s.doc.units)
  const version = useShelf((s) => s.version)
  const favourite = useShelf((s) => s.favourites.includes(partId))
  const show = usePartsView((s) => s.show)
  const openMaker = usePartsView((s) => s.openMaker)
  const part = useMemo(() => getPart(partId), [partId, version])
  const versions = useMemo(
    () =>
      part?.family
        ? allParts()
            .filter((p) => p.family === part.family)
            .sort(byPopularity)
        : [],
    [part, version],
  )

  if (!part)
    return (
      <>
        <button className="parts-back" onClick={() => show(back)}>
          {t('‹ Back')}
        </button>
        <div className="parts-empty">
          <span>{t('This part is no longer in the catalogue.')}</span>
        </div>
      </>
    )

  const family = part.family ? FAMILIES.get(part.family) : undefined
  const mine = isUserPart(part.id)
  const editable = !!partToDraft(part)

  return (
    <div className="parts-details">
      <button className="parts-back" onClick={() => show(back)}>
        {t('‹ Back')}
      </button>
      <div className="parts-preview">
        <PartPreview part={part} />
      </div>
      <div
        className="parts-drag"
        draggable
        title={t('Drag onto a face in the view to place it there')}
        onDragStart={(e) => startPartDrag(e, part.id)}
        onDragEnd={endPartDrag}
      >
        <span aria-hidden="true">⠿</span>
        {t(' Drag into the view')}
      </div>
      <h3>{part.name}</h3>
      <p className="parts-byline">
        {[part.manufacturer, t(CATEGORY_LABEL[part.category]), mine ? t('Your part') : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      {family && versions.length > 1 && (
        <div
          className="parts-version-list"
          role="radiogroup"
          aria-label={`${family.name} versions`}
        >
          {versions.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={v.id === part.id}
              className={`parts-chip ${v.id === part.id ? 'on' : ''}`}
              onClick={() => show({ kind: 'details', partId: v.id, back })}
            >
              {v.variant ?? v.name}
            </button>
          ))}
        </div>
      )}
      <p className="parts-summary">{partSummary(part)}</p>
      <dl className="parts-facts">
        {partFacts(part, units).map((fact) => (
          <Fragment key={fact.label}>
            <dt>{t(fact.label)}</dt>
            <dd>{fact.value}</dd>
          </Fragment>
        ))}
      </dl>
      {part.electrical?.note && <p className="parts-note">{part.electrical.note}</p>}
      <div className={`parts-accuracy ${part.confidence}`}>
        <strong>{t(CONFIDENCE_LABEL[part.confidence])}</strong>
        <span>{part.source}</span>
      </div>
      {!!part.links?.length && (
        <div className="parts-links">
          {part.links.map((link) => (
            <a
              key={link.url}
              className="link"
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
      <div className="parts-actions">
        <button className="btn primary" onClick={() => placePart(part.id)}>
          {t('Insert')}
        </button>
        <button
          className="btn"
          aria-pressed={favourite}
          onClick={() => useShelf.getState().toggleFavourite(part.id)}
        >
          {favourite ? t('★ Favourite') : t('☆ Favourite')}
        </button>
        {mine && editable && (
          <button className="btn" onClick={() => openMaker({ mode: 'edit', partId: part.id })}>
            {t('Edit')}
          </button>
        )}
        {editable && (
          <button
            className="btn"
            title={t('Make your own copy to change its measurements')}
            onClick={() => openMaker({ mode: 'copy', partId: part.id })}
          >
            {t('Copy and edit')}
          </button>
        )}
      </div>
      <p className="parts-hint">
        {t(
          'Dragged onto a face, it lands flat on that face, centred where you let go. Drag the picture to turn it round.',
        )}
      </p>
    </div>
  )
}
