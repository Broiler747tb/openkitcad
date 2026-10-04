import { t } from '../i18n'
import { useState } from 'react'
import {
  allParts,
  CATEGORY_LABEL,
  draftProblems,
  draftToPart,
  editedPart,
  emptyDraft,
  partToDraft,
  refreshUserParts,
  slugify,
  uniquePartId,
  upsertUserPart,
  type CataloguePart,
  type PartCategory,
  type PartDraft,
} from '../catalogue'
import { downloadBlob } from '../doc/persist'
import { useStore } from '../doc/store'
import { useShelf } from './parts/shelf'

const REPO = 'https://github.com/Broiler747tb/openkitcad'

const CATEGORIES: PartCategory[] = [
  'sbc',
  'mcu',
  'proto',
  'connector',
  'display',
  'sensor',
  'power',
  'fastener',
  'extrusion',
  'motor',
  'motion',
  'control',
]

/**
 * Build a part the catalogue does not have yet.
 *
 * The catalogue is the point of this app and it will always be missing the
 * board somebody is holding. This is the answer to that: measure it, use it
 * straight away, and send it in afterwards if you feel like it. Deliberately in
 * that order - a form whose only outcome was a pull request would be asking for
 * a favour, and most people would close it.
 *
 * The fields are the ones the app can actually build geometry from. Outline,
 * thickness and mounting holes are the whole of what makes a part useful for
 * laying out a plate; everything else in the schema is optional and can be
 * filled in later by whoever reviews it.
 */
export function PartMaker({
  onClose,
  base,
  mode = 'new',
}: {
  onClose: () => void
  base?: CataloguePart
  mode?: 'new' | 'edit' | 'copy'
}) {
  const [draft, setDraft] = useState<PartDraft>(() => {
    const from = base ? partToDraft(base) : null
    if (!from) return emptyDraft()
    return mode === 'copy' ? { ...from, name: `${from.name} (my copy)` } : from
  })
  const [saved, setSaved] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const set = <K extends keyof PartDraft>(key: K, value: PartDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const editing = mode !== 'new' && !!base && !!partToDraft(base)
  const part =
    editing && base
      ? editedPart(
          base,
          draft,
          mode === 'edit'
            ? base.id
            : (savedId ??
                uniquePartId(
                  slugify(draft.name) || 'my-part',
                  new Set(allParts().map((p) => p.id)),
                )),
        )
      : draftToPart(draft)
  const json = `${JSON.stringify(part, null, 2)}\n`
  const { blocking, warnings } = draftProblems(draft)

  const addHole = () =>
    set('holes', [
      ...draft.holes,
      {
        id: `h${draft.holes.length + 1}`,
        // Offset in from a corner, which is where mounting holes nearly always
        // are, so the first one usually needs one number changed rather than two.
        x: 3.5,
        y: 3.5,
        diameter: 2.7,
        screw: 'M2.5',
      },
    ])

  const setHole = (index: number, patch: Partial<PartDraft['holes'][number]>) =>
    set(
      'holes',
      draft.holes.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    )

  const useIt = () => {
    upsertUserPart(part)
    refreshUserParts()
    useShelf.getState().changed()
    setSavedId(part.id)
    setSaved(true)
    useStore
      .getState()
      .setStatus(`"${part.name}" is in your catalogue now, under ${CATEGORY_LABEL[part.category]}.`)
  }

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal wide" onPointerDown={(e) => e.stopPropagation()}>
        <h2>
          {mode === 'edit'
            ? t('Edit {0}', base?.name ?? 'your part')
            : mode === 'copy'
              ? t('Your own copy of {0}', base?.name ?? 'a part')
              : t("Add a part that isn't here yet")}
        </h2>
        <p className="hint">
          {mode === 'new'
            ? t(
                "Measure the board in front of you and it becomes usable straight away, holes and standoffs and all. If you want to send it in afterwards so nobody else has to measure the same board, there's a button for that at the bottom.",
              )
            : t(
                'Change the measurements and save. Parts already placed in your design update to match.',
              )}
        </p>

        <div className="section">
          <h3>{t('What it is')}</h3>
          <div className="row">
            <label>{t('Name')}</label>
            <input
              autoFocus
              value={draft.name}
              placeholder={t('Seeed XIAO ESP32-C3')}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="row">
            <label>{t('Kind')}</label>
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value as PartCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_LABEL[c])}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label>{t('Made by')}</label>
            <input
              value={draft.manufacturer}
              placeholder={t('Optional')}
              onChange={(e) => set('manufacturer', e.target.value)}
            />
          </div>
          <div className="row">
            <label>{t('One line')}</label>
            <input
              value={draft.summary}
              placeholder={t('What someone reads in the list')}
              onChange={(e) => set('summary', e.target.value)}
            />
          </div>
        </div>

        <div className="section">
          <h3>{t('Size')}</h3>
          <p className="hint">
            {t('Measured across the board itself, not including anything hanging over the edge.')}
          </p>
          <div className="row">
            <label>{t('Width')}</label>
            <input
              type="number"
              step="0.1"
              value={draft.width}
              onChange={(e) => set('width', Number(e.target.value))}
            />
          </div>
          <div className="row">
            <label>{t('Depth')}</label>
            <input
              type="number"
              step="0.1"
              value={draft.depth}
              onChange={(e) => set('depth', Number(e.target.value))}
            />
          </div>
          <div className="row">
            <label>{t('Thickness')}</label>
            <input
              type="number"
              step="0.1"
              value={draft.thickness}
              onChange={(e) => set('thickness', Number(e.target.value))}
            />
          </div>
          <div className="row">
            <label>{t('Corner radius')}</label>
            <input
              type="number"
              step="0.5"
              value={draft.cornerRadius}
              onChange={(e) => set('cornerRadius', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="section">
          <h3>{t('Mounting holes')}</h3>
          <p className="hint">
            {t(
              'Measured from the bottom-left corner of the board, which is how datasheets dimension them, so the numbers copy straight across. This is the part that earns its keep: it is what generates holes and standoffs later.',
            )}
          </p>
          {draft.holes.map((hole, i) => (
            <div className="row hole-row" key={i}>
              <input
                type="number"
                step="0.1"
                value={hole.x}
                onChange={(e) => setHole(i, { x: Number(e.target.value) })}
              />
              <input
                type="number"
                step="0.1"
                value={hole.y}
                onChange={(e) => setHole(i, { y: Number(e.target.value) })}
              />
              <input
                type="number"
                step="0.1"
                value={hole.diameter}
                onChange={(e) => setHole(i, { diameter: Number(e.target.value) })}
              />
              <input
                value={hole.screw ?? ''}
                placeholder={t('M2.5')}
                onChange={(e) => setHole(i, { screw: e.target.value })}
              />
              <button
                className="tb"
                title={t('Remove this hole')}
                onClick={() =>
                  set(
                    'holes',
                    draft.holes.filter((_, j) => j !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {draft.holes.length > 0 && (
            <p className="hint hole-legend">{t('across, up, hole size, screw')}</p>
          )}
          <button className="btn" onClick={addHole}>
            {t('Add a hole')}
          </button>
        </div>

        <div className="section">
          <h3>{t('How sure are you')}</h3>
          <p className="hint">
            {t(
              "This is shown to anyone who uses the part. A catalogue that mixes datasheet figures with someone's best guess quietly is worse than no catalogue, so it is asked outright rather than assumed.",
            )}
          </p>
          <div className="row">
            <label>{t('These numbers')}</label>
            <select
              value={draft.confidence}
              onChange={(e) => set('confidence', e.target.value as PartDraft['confidence'])}
            >
              <option value="datasheet">{t('Come from a datasheet drawing')}</option>
              <option value="measured">{t('I measured with calipers')}</option>
              <option value="approximate">{t('Are close enough to lay out around')}</option>
            </select>
          </div>
          <div className="row">
            <label>{t('Where from')}</label>
            <input
              value={draft.source}
              placeholder={t("Which datasheet, or what you measured and what you didn't")}
              onChange={(e) => set('source', e.target.value)}
            />
          </div>
          <div className="row">
            <label>{t('Datasheet link')}</label>
            <input
              value={draft.datasheet}
              placeholder={t('Optional')}
              onChange={(e) => set('datasheet', e.target.value)}
            />
          </div>
          <div className="row">
            <label>{t('Search terms')}</label>
            <input
              value={draft.tags}
              placeholder={t('esp32 xiao wifi')}
              onChange={(e) => set('tags', e.target.value)}
            />
          </div>
        </div>

        {blocking.length > 0 && (
          <div className="section problems">
            {blocking.map((m) => (
              <p key={m} className="problem">
                {m}
              </p>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="section problems">
            {warnings.map((m) => (
              <p key={m} className="warn-line">
                {m}
              </p>
            ))}
          </div>
        )}

        <details className="section">
          <summary>{t('See the file this makes')}</summary>
          <pre className="json-preview">{json}</pre>
        </details>

        <div className="modal-actions">
          <button className="btn primary" disabled={blocking.length > 0} onClick={useIt}>
            {saved
              ? t('Saved. Use it from the catalogue')
              : mode === 'edit'
                ? t('Save changes')
                : t('Add it to my catalogue')}
          </button>
          <button
            className="btn"
            disabled={blocking.length > 0}
            onClick={() =>
              downloadBlob(new Blob([json], { type: 'application/json' }), `${part.id}.json`)
            }
          >
            {t('Download the file')}
            <small>{t('Drop it in src/catalogue/parts/ and open a pull request')}</small>
          </button>
          <a
            className="btn"
            href={`${REPO}/issues/new?title=${encodeURIComponent(
              `Add part: ${draft.name || 'a part'}`,
            )}&body=${encodeURIComponent(
              `Measured with OpenKitCAD's part builder.\n\n\`\`\`json\n${json}\`\`\`\n`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            {t('Send it in')}
            <small>{t('Opens a pre-filled issue with the file in it')}</small>
          </a>
          <button className="btn" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
        <p className="hint">
          {t(
            'The catalogue is CC0, so a part you contribute belongs to everybody, including people who never use this app. That is the point of it.',
          )}
        </p>
      </div>
    </div>
  )
}
