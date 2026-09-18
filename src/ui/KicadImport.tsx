import { useMemo, useState } from 'react'
import {
  allParts,
  CATEGORY_LABEL,
  refreshUserParts,
  slugify,
  uniquePartId,
  upsertUserPart,
  type PartCategory,
} from '../catalogue'
import { kicadPart, readKicadBoard, type KicadBoard, type KicadFootprint } from '../catalogue/kicad'
import { useStore } from '../doc/store'
import { useShelf } from './parts/shelf'

const CATEGORIES: PartCategory[] = [
  'mcu',
  'sbc',
  'sensor',
  'power',
  'display',
  'connector',
  'control',
]

export interface KicadFile {
  board: KicadBoard
  file: string
}

export function pickKicadBoard(): Promise<KicadFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.kicad_pcb'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const store = useStore.getState()
      store.setBusy(`Reading ${file.name}`)
      try {
        resolve({ board: readKicadBoard(await file.text(), file.name), file: file.name })
      } catch (error) {
        store.setStatus((error as Error).message)
        resolve(null)
      } finally {
        useStore.getState().setBusy(null)
      }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function rank(footprint: KicadFootprint): number {
  return (/^J/i.test(footprint.ref) ? 0 : 2) + (footprint.edge ? 0 : 1)
}

function shortName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
}

export function KicadImport({ board, file, onClose }: KicadFile & { onClose: () => void }) {
  const [name, setName] = useState(board.name)
  const [category, setCategory] = useState<PartCategory>('mcu')
  const [connectors, setConnectors] = useState<ReadonlySet<string>>(() => new Set())
  const [heights, setHeights] = useState<Record<string, number>>({})
  const rows = useMemo(
    () =>
      [...board.footprints].sort(
        (a, b) => rank(a) - rank(b) || a.ref.localeCompare(b.ref, undefined, { numeric: true }),
      ),
    [board],
  )
  const toggle = (key: string) =>
    setConnectors((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const save = () => {
    const id = uniquePartId(
      slugify(name) || 'kicad-board',
      new Set(allParts().map((part) => part.id)),
    )
    const part = kicadPart(board, { name, category, connectors, heights }, id)
    upsertUserPart(part)
    refreshUserParts()
    useShelf.getState().changed()
    useStore
      .getState()
      .setStatus(`"${part.name}" is in your parts now, under ${CATEGORY_LABEL[part.category]}.`)
    onClose()
  }
  const size = `${board.width.toFixed(1)} x ${board.depth.toFixed(1)} mm, ${board.thickness} mm thick`
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal wide kicad-import" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Import {file}</h2>
        <p className="hint">
          The outline, thickness and mounting holes come straight from the board file. Heights are
          guessed from each footprint's name, so change any that look wrong. Tick the parts that
          need a hole through a wall: they become openings for Port Cutouts and Enclosure.
        </p>

        <div className="section">
          <h3>What it is</h3>
          <div className="row">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="row">
            <label>Kind</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as PartCategory)}>
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {CATEGORY_LABEL[entry]}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            {size}, {board.holes.length} mounting {board.holes.length === 1 ? 'hole' : 'holes'},{' '}
            {board.footprints.length} {board.footprints.length === 1 ? 'part' : 'parts'}.
          </p>
          {board.warnings.map((warning) => (
            <p key={warning} className="warn-line">
              {warning}
            </p>
          ))}
        </div>

        <div className="section">
          <h3>Parts on the board</h3>
          {rows.length ? (
            <div className="kicad-parts">
              <table>
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Part</th>
                    <th>Footprint</th>
                    <th>Height</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((footprint) => (
                    <tr key={footprint.key} data-kicad-ref={footprint.key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${footprint.ref} needs an opening`}
                          checked={connectors.has(footprint.key)}
                          onChange={() => toggle(footprint.key)}
                        />
                      </td>
                      <td title={footprint.value}>
                        {footprint.ref}
                        {footprint.back && <small> underneath</small>}
                        {footprint.edge && <small> at the edge</small>}
                      </td>
                      <td className="kicad-footprint" title={footprint.name}>
                        {shortName(footprint.name)}
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label={`${footprint.ref} height`}
                          title={footprint.reason}
                          value={heights[footprint.key] ?? footprint.height}
                          onChange={(e) =>
                            setHeights((current) => ({
                              ...current,
                              [footprint.key]: Number(e.target.value),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">No footprints on this board, so it comes in as a bare board.</p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={save}>
            Add it to my parts
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
