import { findBody, findComponent, findOccurrence, pathKey } from '../../../doc/model'
import { componentInstance, occurrencePathOf } from '../../../doc/store'
import { FIT_CLASSES, isFitClass, linkFitClass } from '../../../doc/fits'
import type { BoardClipsFeature, FitClass, OkcDocument } from '../../../doc/types'
import { classGap } from './fit'
import { defineCommand, type SelectionPick } from '../types'

const FIT_OPTIONS = [
  ...FIT_CLASSES.map((entry) => ({ value: entry.value, label: entry.label, hint: entry.hint })),
  { value: 'custom', label: 'Custom', hint: 'Type the gap yourself.' },
]

function boardOf(doc: OkcDocument, picks: readonly SelectionPick[]) {
  const pick = picks[0]
  if (!pick) return null
  const path = pick.kind === 'occurrence' ? occurrencePathOf(doc, pick.id, pick.instanceId) : null
  if (!path?.length) return null
  const occurrence = findOccurrence(doc, path[path.length - 1])
  const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
  if (component?.source.kind !== 'catalogue') return null
  return { path, name: occurrence?.name ?? 'board' }
}

export const boardClipsCommand = defineCommand({
  id: 'boardClips',
  label: 'Board Clips',
  hint: 'Clips along two edges of a placed board, so it snaps in without screws.',
  icon: '⊐',
  inputs: [
    {
      id: 'board',
      kind: 'selection',
      label: 'Board',
      hint: 'The board already placed in the design. The clips take its size and follow it.',
      filter: ['occurrence'],
      min: 1,
      max: 1,
      prompt: 'Select the board',
    },
    {
      id: 'body',
      kind: 'selection',
      label: 'Body',
      hint: 'The part the clips stand on.',
      filter: ['body'],
      min: 1,
      max: 1,
      prompt: 'Select the body under it',
    },
    {
      id: 'count',
      kind: 'integer',
      label: 'Clips per Edge',
      default: 2,
      min: 1,
      max: 6,
    },
    {
      id: 'width',
      kind: 'length',
      label: 'Clip Width',
      hint: 'How wide each clip is along the edge.',
      default: 8,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'grip',
      kind: 'length',
      label: 'Grip',
      hint: 'How far the hook and the ledge reach over the board.',
      default: 1.2,
      min: 0,
      exclusiveMin: true,
    },
    {
      id: 'post',
      kind: 'length',
      label: 'Post Thickness',
      hint: 'How thick the upright is. Thinner flexes more.',
      default: 2.4,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    {
      id: 'fit',
      kind: 'choice',
      label: 'Fit',
      options: FIT_OPTIONS,
      default: 'snug',
      display: 'buttons',
    },
    {
      id: 'gap',
      kind: 'length',
      label: 'Gap',
      hint: 'Room between the board edge and the clip.',
      default: 0.2,
      min: 0,
      field: 'gap',
    },
  ],
  validate(values, context) {
    if (!boardOf(context.doc, values.board)) {
      return { board: 'Pick a board from the catalogue that is placed in the design.' }
    }
    const bodyId = values.body[0]?.id
    if (!bodyId || !findBody(context.doc, bodyId)) return { body: 'Pick the body they stand on.' }
    return null
  },
  derive(values, changed, context) {
    if (changed !== 'fit') return null
    if (!isFitClass(values.fit)) return null
    return { gap: classGap(context.doc, values.fit) }
  },
  build(values, context) {
    const board = boardOf(context.doc, values.board)!
    const bodyId = values.body[0].id
    const body = findBody(context.doc, bodyId)!
    const contextPath = componentInstance(context.doc, body.component.id)?.path ?? []
    const feature: BoardClipsFeature = {
      id: context.editing?.id ?? context.id('boardClips'),
      kind: 'boardClips',
      name: context.editing?.name ?? `Clips for ${board.name}`,
      componentId: body.component.id,
      bodyId,
      occurrencePath: board.path,
      contextPath,
      count: values.count,
      width: values.width,
      post: values.post,
      grip: values.grip,
      ledge: values.grip,
      hook: 1.2,
      gap: values.gap,
      ...(isFitClass(values.fit) ? { fitClass: values.fit as FitClass } : {}),
    }
    return [feature]
  },
  adjust(doc, features, _context, values) {
    const feature = features.find((candidate) => candidate.kind === 'boardClips')
    if (!feature) return
    linkFitClass(
      doc,
      feature.id,
      isFitClass(values.fit) ? (values.fit as FitClass) : undefined,
      values.gap,
    )
  },
})

export function clipsBoardKey(feature: BoardClipsFeature): string {
  return pathKey(feature.occurrencePath)
}
