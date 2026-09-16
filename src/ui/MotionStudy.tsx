import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { motionDofs } from '../assembly/motion'
import { poseStudy, trackValue } from '../assembly/study'
import { activeFeatures, findFeature } from '../doc/model'
import { insertFeatures, newId, replaceFeatureInDocument, useStore } from '../doc/store'
import type { MotionStudyFeature, OkcDocument } from '../doc/types'
import { DOF_LABEL } from './command/specs/assemble'
import { useCommand } from './command/session'

interface MotionStudyState {
  draft: MotionStudyFeature | null
  editingId: string | null
  base: OkcDocument | null
  step: number
  playing: boolean
  loop: boolean
}

export const useMotionStudy = create<MotionStudyState>(() => ({
  draft: null,
  editingId: null,
  base: null,
  step: 0,
  playing: false,
  loop: true,
}))

function restorePose(base: OkcDocument) {
  useStore.getState().commit(
    (draft) => {
      draft.occurrences = structuredClone(base.occurrences)
      for (const feature of draft.timeline) {
        const original = findFeature(base, feature.id)
        if (feature.kind === 'joint' && original?.kind === 'joint') {
          feature.values = [...original.values]
        }
      }
    },
    { transient: true },
  )
}

function showStep(step: number) {
  const { draft, base } = useMotionStudy.getState()
  if (!draft || !base) return
  useMotionStudy.setState({ step })
  useStore.getState().commit((doc) => void poseStudy(doc, draft, step), { transient: true })
}

export function openMotionStudy(feature?: MotionStudyFeature) {
  closeMotionStudy()
  useCommand.getState().cancel()
  const doc = useStore.getState().doc
  const draft: MotionStudyFeature = feature
    ? structuredClone(feature)
    : {
        id: newId('motionStudy'),
        kind: 'motionStudy',
        name: `Motion Study ${doc.timeline.filter((f) => f.kind === 'motionStudy').length + 1}`,
        componentId: doc.rootComponentId,
        steps: 60,
        tracks: [],
      }
  useMotionStudy.setState({
    draft,
    editingId: feature?.id ?? null,
    base: doc,
    step: 0,
    playing: false,
  })
}

export function closeMotionStudy() {
  const { base } = useMotionStudy.getState()
  useMotionStudy.setState({ draft: null, editingId: null, base: null, playing: false, step: 0 })
  if (base) restorePose(base)
}

function commitMotionStudy() {
  const { draft, editingId } = useMotionStudy.getState()
  if (!draft) return
  closeMotionStudy()
  useStore.getState().commit((doc) => {
    if (editingId && findFeature(doc, editingId)) replaceFeatureInDocument(doc, editingId, [draft])
    else insertFeatures(doc, [draft])
  })
}

function updateDraft(change: (draft: MotionStudyFeature) => void) {
  const { draft, step } = useMotionStudy.getState()
  if (!draft) return
  const next = structuredClone(draft)
  change(next)
  next.steps = Math.max(1, Math.round(next.steps))
  useMotionStudy.setState({ draft: next })
  showStep(Math.min(step, next.steps))
}

export function MotionStudyHost() {
  const draft = useMotionStudy((s) => s.draft)
  useEffect(
    () =>
      useCommand.subscribe((state) => {
        if (state.session && useMotionStudy.getState().draft) closeMotionStudy()
      }),
    [],
  )
  return draft ? <MotionStudyPanel /> : null
}

function NumberCell({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value])
  const commit = () => {
    const parsed = Number(text)
    if (Number.isFinite(parsed) && parsed !== value) onChange(parsed)
    else setText(String(Math.round(value * 1000) / 1000))
  }
  return (
    <input
      className="okc-cmd-input okc-study-number"
      aria-label={label}
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function MotionStudyPanel() {
  const draft = useMotionStudy((s) => s.draft)!
  const step = useMotionStudy((s) => s.step)
  const playing = useMotionStudy((s) => s.playing)
  const loop = useMotionStudy((s) => s.loop)
  const editingId = useMotionStudy((s) => s.editingId)
  const doc = useStore((s) => s.doc)
  const base = useMotionStudy((s) => s.base)
  const frame = useRef(0)

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let position = useMotionStudy.getState().step
    const tick = (now: number) => {
      const { draft: live, loop: looping } = useMotionStudy.getState()
      if (!live) return
      position += ((now - last) / 1000) * (live.steps / 3)
      last = now
      if (position >= live.steps) {
        if (!looping) {
          showStep(live.steps)
          useMotionStudy.setState({ playing: false })
          return
        }
        position %= live.steps
      }
      showStep(Math.round(position * 100) / 100)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeMotionStudy()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const joints = activeFeatures(base ?? doc).flatMap((feature) =>
    feature.kind === 'joint'
      ? motionDofs(feature.motion).map((dof, index) => ({
          value: `${feature.id}:${index}`,
          label: `${feature.name} · ${DOF_LABEL[dof.name]}`,
          unit: dof.kind === 'rotate' ? '°' : doc.units,
        }))
      : [],
  )
  const unused = joints.filter(
    (option) => !draft.tracks.some((track) => `${track.jointId}:${track.dof}` === option.value),
  )
  const valueNow = (jointId: string, dof: number) => {
    const joint = findFeature(base ?? doc, jointId)
    return joint?.kind === 'joint' ? (joint.values[dof] ?? 0) : 0
  }

  return (
    <div className="okc-cmd okc-study" role="dialog" aria-label="Motion Study">
      <div className="okc-cmd-title">
        <span className="okc-cmd-icon" aria-hidden="true">
          ⏵
        </span>
        <span className="okc-cmd-name">Motion Study</span>
      </div>
      <p className="okc-cmd-hint">
        Moves joints over time. Add a joint, give it a value at a few steps, then play.
      </p>
      <div className="okc-cmd-body">
        <label className="okc-cmd-row">
          <span className="okc-cmd-label">Name</span>
          <input
            className="okc-cmd-input"
            value={draft.name}
            onChange={(e) => updateDraft((next) => void (next.name = e.target.value))}
          />
        </label>
        <div className="okc-cmd-row">
          <span className="okc-cmd-label">Steps</span>
          <NumberCell
            label="Steps"
            value={draft.steps}
            onChange={(value) => updateDraft((next) => void (next.steps = value))}
          />
        </div>
        <div className="okc-study-transport">
          <button
            type="button"
            className="okc-cmd-button"
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={!draft.tracks.length}
            onClick={() => {
              if (!playing && step >= draft.steps) showStep(0)
              useMotionStudy.setState({ playing: !playing })
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            aria-label="Step"
            min={0}
            max={draft.steps}
            step={1}
            value={step}
            onChange={(e) => {
              useMotionStudy.setState({ playing: false })
              showStep(Number(e.target.value))
            }}
          />
          <span className="okc-study-step">{Math.round(step)}</span>
          <label className="okc-study-loop" title="Start again at the end">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => useMotionStudy.setState({ loop: e.target.checked })}
            />
            Loop
          </label>
        </div>
        {draft.tracks.map((track, trackIndex) => {
          const option = joints.find((entry) => entry.value === `${track.jointId}:${track.dof}`)
          return (
            <div key={`${track.jointId}:${track.dof}`} className="okc-study-track">
              <div className="okc-study-track-head">
                <span>{option?.label ?? 'A missing joint'}</span>
                <button
                  type="button"
                  className="okc-study-remove"
                  aria-label="Remove joint from the study"
                  onClick={() => updateDraft((next) => void next.tracks.splice(trackIndex, 1))}
                >
                  ✕
                </button>
              </div>
              {track.keys.map((key, keyIndex) => (
                <div key={keyIndex} className="okc-study-key">
                  <span>Step</span>
                  <NumberCell
                    label="Step"
                    value={key.step}
                    onChange={(value) =>
                      updateDraft(
                        (next) =>
                          void (next.tracks[trackIndex].keys[keyIndex].step = Math.min(
                            next.steps,
                            Math.max(0, Math.round(value)),
                          )),
                      )
                    }
                  />
                  <span>{option?.unit ?? ''}</span>
                  <NumberCell
                    label="Value"
                    value={key.value}
                    onChange={(value) =>
                      updateDraft(
                        (next) => void (next.tracks[trackIndex].keys[keyIndex].value = value),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="okc-study-remove"
                    aria-label="Remove key"
                    onClick={() =>
                      updateDraft((next) => void next.tracks[trackIndex].keys.splice(keyIndex, 1))
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="okc-study-add"
                onClick={() =>
                  updateDraft((next) => {
                    const at = Math.round(step)
                    const keys = next.tracks[trackIndex].keys
                    const value = trackValue(track, at, valueNow(track.jointId, track.dof))
                    const same = keys.find((entry) => entry.step === at)
                    if (same) same.value = value
                    else keys.push({ step: at, value })
                    keys.sort((a, b) => a.step - b.step)
                  })
                }
              >
                + Key at step {Math.round(step)}
              </button>
            </div>
          )
        })}
        <div className="okc-cmd-row">
          <span className="okc-cmd-label">Add joint</span>
          <select
            className="okc-cmd-input"
            aria-label="Add joint"
            value=""
            disabled={!unused.length}
            onChange={(e) => {
              const [jointId, dof] = e.target.value.split(':')
              const start = valueNow(jointId, Number(dof))
              updateDraft((next) =>
                next.tracks.push({
                  jointId,
                  dof: Number(dof),
                  keys: [
                    { step: 0, value: start },
                    { step: next.steps, value: start },
                  ],
                }),
              )
            }}
          >
            <option value="">{unused.length ? 'Choose a joint' : 'No joints with motion'}</option>
            {unused.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="okc-cmd-footer">
        <button
          type="button"
          className="okc-cmd-button okc-cmd-ok"
          onClick={commitMotionStudy}
          disabled={!draft.name.trim()}
        >
          {editingId ? 'OK' : 'Create'}
        </button>
        <button type="button" className="okc-cmd-button okc-cmd-cancel" onClick={closeMotionStudy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
