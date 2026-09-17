import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { lengthText } from '../core/units'
import { activeSketchFeature, useStore } from '../doc/store'
import {
  addedFonts,
  addFontFile,
  computerFonts,
  computerFontsSupported,
  loadFont,
  textOutline,
  type FontChoice,
} from '../sketch/fonts'
import type { TextEntity } from '../sketch/types'
import { parseAngle, parseLength } from './command/units'

export interface TextEditRequest {
  entityId: string
  created: boolean
}

export function openTextEditor(request: TextEditRequest) {
  window.dispatchEvent(new CustomEvent('okc:text', { detail: request }))
}

const PREFERRED = ['Arial', 'Segoe UI', 'Helvetica', 'Roboto', 'Liberation Sans', 'DejaVu Sans']
const MEMORY = 'okc.text'

function remembered(): { font?: string; height?: number } {
  try {
    return JSON.parse(localStorage.getItem(MEMORY) ?? '{}')
  } catch {
    return {}
  }
}

function remember(font: string, height: number) {
  try {
    localStorage.setItem(MEMORY, JSON.stringify({ font, height }))
  } catch {
    return
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function TextPanelHost() {
  const [request, setRequest] = useState<TextEditRequest | null>(null)
  const openRef = useRef<TextEditRequest | null>(null)
  openRef.current = request
  const active = useStore((s) => s.activeSketch?.featureId ?? null)
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<TextEditRequest>).detail
      if (openRef.current && openRef.current.entityId !== next.entityId && !next.created) {
        useStore.getState().endTransient()
      }
      setRequest(next)
    }
    window.addEventListener('okc:text', open)
    return () => window.removeEventListener('okc:text', open)
  }, [])
  useEffect(() => {
    if (active || !request) return
    useStore.getState().endTransient()
    setRequest(null)
  }, [active, request])
  return request && active ? (
    <TextPanel key={request.entityId} request={request} onClose={() => setRequest(null)} />
  ) : null
}

type Listing = 'loading' | 'ready' | 'blocked' | 'unsupported'

function TextPanel({ request, onClose }: { request: TextEditRequest; onClose: () => void }) {
  const units = useStore((s) => s.doc.units)
  const entity = useStore((s) =>
    activeSketchFeature(s)?.sketch.entities.find((item) => item.id === request.entityId),
  ) as TextEntity | undefined
  const memory = useMemo(remembered, [])
  const start = useRef(entity)
  const [text, setText] = useState(start.current?.text ?? 'Text')
  const [fontId, setFontId] = useState(start.current?.font || memory.font || '')
  const [heightText, setHeightText] = useState(() =>
    lengthText(
      request.created && memory.height ? memory.height : (start.current?.height ?? 5),
      units,
    ),
  )
  const [angleText, setAngleText] = useState(String(start.current?.angle ?? 0))
  const [fonts, setFonts] = useState<FontChoice[]>([])
  const [listing, setListing] = useState<Listing>('loading')
  const [problem, setProblem] = useState<string | null>(null)
  const ticket = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    useStore.getState().beginTransient()
  }, [])

  const list = async () => {
    setFonts((known) => (known.length ? known : addedFonts()))
    if (!computerFontsSupported()) {
      setFonts(await computerFonts())
      setListing('unsupported')
      return
    }
    try {
      setFonts(await computerFonts())
      setListing('ready')
    } catch {
      setFonts(addedFonts())
      setListing('blocked')
    }
  }

  useEffect(() => {
    void list()
  }, [])

  useEffect(() => {
    if (!fonts.length || fonts.some((font) => font.id === fontId)) return
    if (fontId && start.current?.font === fontId && start.current.outline) return
    const regular = (family: string) =>
      fonts.find(
        (font) => font.family === family && /^(regular|normal|book|roman)$/i.test(font.style),
      ) ?? fonts.find((font) => font.family === family)
    const pick = PREFERRED.map(regular).find(Boolean) ?? fonts[0]
    setFontId(pick.id)
  }, [fonts])

  useEffect(() => {
    const id = ++ticket.current
    let height: number
    let angle: number
    try {
      height = parseLength(heightText, units)
      if (!(height > 0)) throw new Error('The height has to be more than zero.')
      angle = parseAngle(angleText)
    } catch (error) {
      setProblem(reason(error))
      return
    }
    const apply = async () => {
      const live = activeSketchFeature(useStore.getState())?.sketch.entities.find(
        (item) => item.id === request.entityId,
      )
      if (live?.kind !== 'text') return
      let outline = live.outline
      let blocked: string | null = null
      const wanted = text.trim().length > 0
      if (wanted && (!outline || live.text !== text || live.font !== fontId)) {
        const loading = fontId ? loadFont(fontId) : null
        if (!loading) {
          blocked = fonts.length
            ? `${fontId || 'The saved font'} is not on this computer. Pick a font to change the letters.`
            : 'Pick a font, or load a font file.'
        } else {
          try {
            const font = await loading
            if (id !== ticket.current) return
            outline = textOutline(font, text)
          } catch {
            blocked = 'That font could not be read. Pick another font.'
          }
        }
      }
      if (id !== ticket.current) return
      setProblem(blocked ?? (wanted ? null : 'Type some text.'))
      useStore.getState().editSketch(
        (sketch) => {
          const target = sketch.entities.find((item) => item.id === request.entityId)
          if (target?.kind !== 'text') return
          target.height = height
          target.angle = angle
          if (blocked || !wanted) return
          target.text = text
          target.font = fontId
          target.outline = outline
        },
        { transient: true },
      )
    }
    void apply()
  }, [text, fontId, heightText, angleText, fonts, units])

  const current = fonts.find((font) => font.id === fontId)
  const families = useMemo(() => [...new Set(fonts.map((font) => font.family))], [fonts])
  const styles = current ? fonts.filter((font) => font.family === current.family) : []
  const valid = !!text.trim() && !problem && !!entity?.outline

  const finish = () => {
    if (!valid || !entity) return
    ticket.current++
    remember(fontId, entity.height)
    useStore.getState().endTransient()
    onClose()
  }

  const cancel = () => {
    ticket.current++
    useStore.getState().cancelTransient()
    onClose()
  }

  const keys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') cancel()
    else if (event.key === 'Enter') finish()
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const choice = await addFontFile(file)
      setFonts(await computerFonts().catch(() => addedFonts()))
      setFontId(choice.id)
    } catch (error) {
      setProblem(`That file is not a font this can read: ${reason(error)}`)
    }
  }

  return (
    <div
      className="okc-cmd okc-text-panel"
      role="dialog"
      aria-label="Text"
      data-okc-command="text"
      onKeyDown={keys}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="okc-cmd-title">
        <span className="okc-cmd-name">Text</span>
      </div>
      <p className="okc-cmd-hint">
        The letter shapes are saved in the design, so it opens the same on computers without this
        font.
      </p>
      <div className="okc-cmd-body">
        <div className="okc-cmd-row">
          <span className="okc-cmd-label" id="okc-text-words">
            Text
          </span>
          <div className="okc-cmd-control">
            <input
              className="okc-cmd-input"
              aria-labelledby="okc-text-words"
              value={text}
              autoFocus
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        </div>
        <div className="okc-cmd-row">
          <span className="okc-cmd-label" id="okc-text-font">
            Font
          </span>
          <div className="okc-cmd-control">
            <select
              className="okc-cmd-dropdown"
              aria-labelledby="okc-text-font"
              value={current?.family ?? ''}
              onChange={(event) => {
                const family = event.target.value
                const same = fonts.find(
                  (font) => font.family === family && font.style === current?.style,
                )
                const first = fonts.find((font) => font.family === family)
                const next = same ?? first
                if (next) setFontId(next.id)
              }}
            >
              {!current && (
                <option value="">{fontId ? `${fontId} (missing)` : 'Pick a font'}</option>
              )}
              {families.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </div>
        </div>
        {styles.length > 1 && (
          <div className="okc-cmd-row">
            <span className="okc-cmd-label" id="okc-text-style">
              Style
            </span>
            <div className="okc-cmd-control">
              <select
                className="okc-cmd-dropdown"
                aria-labelledby="okc-text-style"
                value={fontId}
                onChange={(event) => setFontId(event.target.value)}
              >
                {styles.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.style}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="okc-cmd-row">
          <span
            className="okc-cmd-label"
            id="okc-text-height"
            title="Height of the capital letters"
          >
            Height
          </span>
          <div className="okc-cmd-control">
            <div className="okc-cmd-number">
              <input
                className="okc-cmd-input"
                aria-labelledby="okc-text-height"
                inputMode="decimal"
                spellCheck={false}
                value={heightText}
                onChange={(event) => setHeightText(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          </div>
        </div>
        <div className="okc-cmd-row">
          <span className="okc-cmd-label" id="okc-text-angle">
            Angle
          </span>
          <div className="okc-cmd-control">
            <div className="okc-cmd-number">
              <input
                className="okc-cmd-input"
                aria-labelledby="okc-text-angle"
                inputMode="decimal"
                spellCheck={false}
                value={angleText}
                onChange={(event) => setAngleText(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          </div>
        </div>
        <div className="okc-cmd-row">
          <span className="okc-cmd-label">Font file</span>
          <div className="okc-cmd-control">
            <button
              type="button"
              className="okc-cmd-button okc-text-file"
              onClick={() => fileRef.current?.click()}
            >
              Load a font file...
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".ttf,.otf,.ttc,.woff"
              onChange={(event) => {
                void loadFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
      {listing === 'loading' && (
        <div className="okc-cmd-message" role="status" data-tone="warning">
          Looking for the fonts on this computer...
        </div>
      )}
      {listing === 'blocked' && (
        <div className="okc-cmd-message" role="status" data-tone="warning">
          Your fonts are not shared with OpenKitCAD yet.{' '}
          <button type="button" className="okc-text-link" onClick={() => void list()}>
            Use my computer's fonts
          </button>
        </div>
      )}
      {listing === 'unsupported' && !fonts.length && (
        <div className="okc-cmd-message" role="status" data-tone="warning">
          This browser cannot list your fonts. Load a font file instead.
        </div>
      )}
      {problem && (
        <div className="okc-cmd-message" role="status" data-tone="error">
          {problem}
        </div>
      )}
      <div className="okc-cmd-footer">
        <button
          type="button"
          className="okc-cmd-button okc-cmd-ok"
          data-okc-action="ok"
          disabled={!valid}
          onClick={finish}
        >
          OK
        </button>
        <button
          type="button"
          className="okc-cmd-button okc-cmd-cancel"
          data-okc-action="cancel"
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
