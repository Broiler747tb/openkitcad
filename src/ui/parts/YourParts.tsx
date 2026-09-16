import { useMemo, useRef, useState } from 'react'
import {
  allParts,
  CATALOGUE,
  CATEGORY_LABEL,
  partToDraft,
  readPartFile,
  refreshUserParts,
  removeUserPart,
  sizeSummary,
  uniquePartId,
  upsertUserPart,
  userParts,
  type CataloguePart,
} from '../../catalogue'
import { counted } from '../../core/words'
import { downloadBlob } from '../../doc/persist'
import { useStore } from '../../doc/store'
import { partUses } from './actions'
import { PartSketch } from './PartSketch'
import { usePartsView, useShelf } from './shelf'

function saveJson(value: unknown, filename: string) {
  downloadBlob(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
    filename,
  )
}

function changed() {
  refreshUserParts()
  useShelf.getState().changed()
}

export function YourParts() {
  const version = useShelf((s) => s.version)
  const units = useStore((s) => s.doc.units)
  const show = usePartsView((s) => s.show)
  const openMaker = usePartsView((s) => s.openMaker)
  const parts = useMemo(() => {
    refreshUserParts()
    return userParts()
  }, [version])
  const file = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<string[]>([])
  const shipped = useMemo(() => new Set(CATALOGUE.map((part) => part.id)), [])

  const remove = (part: CataloguePart) => {
    const uses = partUses(part.id)
    const builtIn = shipped.has(part.id)
    const warning = uses
      ? builtIn
        ? ` It is placed ${counted(uses, 'time')} in this design, and those go back to the built-in version.`
        : ` It is placed ${counted(uses, 'time')} in this design, and those will show as missing.`
      : ''
    if (!confirm(`Delete "${part.name}" from your parts?${warning}`)) return
    removeUserPart(part.id)
    if (!builtIn) useShelf.getState().forget(part.id)
    changed()
    useStore.getState().setStatus(`"${part.name}" deleted from your parts.`)
  }

  const duplicate = (part: CataloguePart) => {
    const taken = new Set(allParts().map((p) => p.id))
    const copy: CataloguePart = {
      ...structuredClone(part),
      id: uniquePartId(`${part.id}-copy`, taken),
      name: `${part.name} (copy)`,
    }
    upsertUserPart(copy)
    changed()
    useStore.getState().setStatus(`"${copy.name}" added to your parts.`)
  }

  const importFiles = async (files: FileList) => {
    const lines: string[] = []
    let added = 0
    for (const item of Array.from(files)) {
      const { parts: found, problems } = readPartFile(await item.text())
      for (const part of found) upsertUserPart(part)
      added += found.length
      lines.push(...problems.map((problem) => `${item.name}: ${problem}`))
    }
    changed()
    setReport([added ? `Added ${counted(added, 'part')}.` : 'Nothing was added.', ...lines])
  }

  return (
    <div className="parts-mine">
      <button className="parts-back" onClick={() => show({ kind: 'home' })}>
        ‹ All parts
      </button>
      <div className="parts-heading">
        <strong>Your parts</strong>
        <span>
          Parts you measured or imported. They live in this browser, so export them to keep a copy
          or move them to another computer.
        </span>
      </div>
      <div className="parts-actions">
        <button className="btn primary" onClick={() => openMaker({ mode: 'new' })}>
          New part
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Import…
        </button>
        <button
          className="btn"
          disabled={!parts.length}
          onClick={() => saveJson(parts, 'openkitcad-parts.json')}
        >
          Export all
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void importFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {report.length > 0 && (
        <div className="parts-report" role="status">
          {report.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      )}
      {!parts.length && (
        <div className="parts-empty">
          <span>
            Nothing here yet. Measure a board with New part, or import a part file somebody sent
            you.
          </span>
        </div>
      )}
      {parts.map((part) => {
        const uses = partUses(part.id)
        return (
          <div key={part.id} className="parts-mine-row">
            <button
              className="parts-row-main"
              onClick={() => show({ kind: 'details', partId: part.id, back: { kind: 'mine' } })}
            >
              <PartSketch part={part} className="parts-thumb" />
              <span className="parts-row-text">
                <strong>
                  {part.name}
                  {shipped.has(part.id) && (
                    <span className="parts-tag" title="Replaces the built-in part with the same id">
                      override
                    </span>
                  )}
                </strong>
                <span>
                  {CATEGORY_LABEL[part.category]} · {sizeSummary(part, units)}
                  {uses ? ` · used ${counted(uses, 'time')}` : ''}
                </span>
              </span>
            </button>
            <div className="parts-mine-actions">
              <button
                className="btn"
                disabled={!partToDraft(part)}
                title={
                  partToDraft(part)
                    ? 'Change its measurements'
                    : 'Only rectangular boards can be edited here. Export it and edit the file instead.'
                }
                onClick={() => openMaker({ mode: 'edit', partId: part.id })}
              >
                Edit
              </button>
              <button className="btn" onClick={() => duplicate(part)}>
                Duplicate
              </button>
              <button className="btn" onClick={() => saveJson(part, `${part.id}.json`)}>
                Export
              </button>
              <button className="btn danger" onClick={() => remove(part)}>
                Delete
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
