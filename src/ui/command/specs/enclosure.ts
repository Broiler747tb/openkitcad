import { getPart } from '../../../catalogue'
import { effectivePart } from '../../../catalogue/placement'
import type { CataloguePart } from '../../../catalogue/types'
import { FIT_CLASSES, isFitClass, linkFitClass } from '../../../doc/fits'
import { findComponent, findOccurrence, pathKey } from '../../../doc/model'
import { componentInstance, occurrencePathOf } from '../../../doc/store'
import type {
  EnclosureFeature,
  EnclosureMount,
  FitClass,
  LidStyle,
  MountKind,
  OkcDocument,
} from '../../../doc/types'
import { classGap } from './fit'
import { occurrencePick } from '../picks'
import { nameBody } from './shared'
import {
  defineCommand,
  type CommandContext,
  type ListRow,
  type ListValue,
  type LooseCommandValues,
  type SelectionPick,
} from '../types'

export const LID_STYLES = [
  {
    value: 'screws',
    label: 'Screws',
    hint: 'Four screws into towers at the corners. The sturdiest, and it opens again.',
  },
  {
    value: 'snap',
    label: 'Snap',
    hint: 'A lid with a bead that clicks into a groove round the rim. No screws.',
  },
  {
    value: 'slide',
    label: 'Slide',
    hint: 'Slides in along grooves from one open end, like a battery cover.',
  },
] as const

const SCREW_SIZES = [
  { value: '2', label: 'M2' },
  { value: '2.5', label: 'M2.5' },
  { value: '3', label: 'M3' },
] as const

export const MOUNT_KINDS = [
  { value: 'standoffs', label: 'Standoffs', hint: 'Posts under its mounting holes, for screws.' },
  { value: 'clips', label: 'Clips', hint: 'Snap hooks over its long edges, so it pushes in.' },
  { value: 'none', label: 'None', hint: 'Leave it loose.' },
] as const

const FIT_OPTIONS = [
  ...FIT_CLASSES.map((entry) => ({ value: entry.value, label: entry.label, hint: entry.hint })),
  { value: 'custom', label: 'Custom', hint: 'Type the gap yourself.' },
]

interface Picked {
  path: string[]
  name: string
  part: CataloguePart
}

function pickedParts(doc: OkcDocument, picks: readonly SelectionPick[]): Picked[] {
  const out: Picked[] = []
  for (const pick of picks) {
    if (pick.kind !== 'occurrence') continue
    const path = occurrencePathOf(doc, pick.id, pick.instanceId)
    if (!path?.length) continue
    const occurrence = findOccurrence(doc, path[path.length - 1])
    const component = occurrence ? findComponent(doc, occurrence.componentId) : undefined
    if (!occurrence || component?.source.kind !== 'catalogue') continue
    const part = getPart(component.source.partId)
    if (part) out.push({ path, name: occurrence.name, part: effectivePart(part, component.source) })
  }
  return out
}

function isBoard(part: CataloguePart): boolean {
  return part.geometry.kind === 'board'
}

function usualMount(part: CataloguePart): MountKind {
  return part.mountingHoles?.length ? 'standoffs' : 'clips'
}

function picksOf(values: LooseCommandValues): SelectionPick[] {
  return Array.isArray(values.parts) ? values.parts : []
}

function mountRows(values: LooseCommandValues, context: CommandContext): ListRow[] {
  return pickedParts(context.doc, picksOf(values))
    .filter((picked) => isBoard(picked.part))
    .map((picked) => ({
      id: pathKey(picked.path),
      label: picked.name,
      options: MOUNT_KINDS,
      default: usualMount(picked.part),
    }))
}

function portRows(values: LooseCommandValues, context: CommandContext): ListRow[] {
  const parts = pickedParts(context.doc, picksOf(values))
  return parts.flatMap((picked) =>
    (picked.part.connectors ?? []).map((connector) => ({
      id: `${pathKey(picked.path)}/${connector.id}`,
      label: parts.length > 1 ? `${picked.name}: ${connector.label}` : connector.label,
      hint: `${connector.label} on ${picked.name}`,
      options: [],
      default: 'off',
    })),
  )
}

export const enclosureCommand = defineCommand({
  id: 'enclosure',
  label: 'Enclosure',
  hint: 'A box sized round the parts you pick, with a lid, mounts for each board and openings for the connectors you tick.',
  icon: '▤',
  inputs: [
    {
      id: 'parts',
      kind: 'selection',
      label: 'Parts',
      hint: 'The boards and parts to put in the box. It is sized round all of them.',
      filter: ['occurrence'],
      min: 1,
      prompt: 'Select the parts',
    },
    {
      id: 'lid',
      kind: 'choice',
      label: 'Lid',
      options: LID_STYLES,
      default: 'screws',
      display: 'buttons',
    },
    {
      id: 'screw',
      kind: 'choice',
      label: 'Screw Size',
      options: SCREW_SIZES,
      default: '3',
      display: 'buttons',
      visible: (values: LooseCommandValues) => values.lid === 'screws',
    },
    {
      id: 'mounting',
      kind: 'list',
      label: 'Mounting',
      hint: 'How each board is held inside.',
      rows: mountRows,
      all: 'All boards',
      empty: 'None of these parts is a board.',
    },
    {
      id: 'ports',
      kind: 'list',
      label: 'Openings',
      hint: 'Tick the connectors that need a hole through the wall.',
      rows: portRows,
      display: 'check',
      all: 'All connectors',
      empty: 'None of these parts has connectors.',
    },
    {
      id: 'tolerance',
      kind: 'length',
      label: 'Opening Room',
      hint: 'Added all the way round each opening.',
      default: 0.6,
      min: 0,
      visible: (values: LooseCommandValues) =>
        Object.values((values.ports ?? {}) as ListValue).includes('on'),
    },
    {
      id: 'clearance',
      kind: 'length',
      label: 'Room Round Parts',
      hint: 'Air between the parts and the walls and lid.',
      default: 2,
      min: 0,
    },
    {
      id: 'under',
      kind: 'length',
      label: 'Room Under',
      hint: 'How high the parts stand off the floor. Standoffs are this tall.',
      default: 4,
      min: 0,
    },
    {
      id: 'wall',
      kind: 'length',
      label: 'Wall',
      default: 2,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    { id: 'floor', kind: 'length', label: 'Floor', default: 2, min: 0, exclusiveMin: true },
    {
      id: 'lidThickness',
      kind: 'length',
      label: 'Lid Thickness',
      default: 2,
      min: 0,
      exclusiveMin: true,
    },
    {
      id: 'fit',
      kind: 'choice',
      label: 'Lid Fit',
      options: FIT_OPTIONS,
      default: 'snug',
      display: 'buttons',
    },
    {
      id: 'gap',
      kind: 'length',
      label: 'Gap',
      hint: 'Room between the lid and the box.',
      default: 0.2,
      min: 0,
      field: 'gap',
    },
  ],
  validate(values, context) {
    const parts = pickedParts(context.doc, values.parts)
    if (!parts.length || parts.length < values.parts.length) {
      return { parts: 'Pick parts from the catalogue that are placed in the design.' }
    }
    if (values.lid === 'slide' && values.wall < 1.2) {
      return { wall: 'A sliding lid needs walls at least 1.2 mm thick for its grooves.' }
    }
    return null
  },
  derive(values, changed, context) {
    if (changed !== 'fit') return null
    if (!isFitClass(values.fit)) return null
    return { gap: classGap(context.doc, values.fit) }
  },
  build(values, context) {
    const parts = pickedParts(context.doc, values.parts)
    const mounts: EnclosureMount[] = parts.map((picked) => {
      const key = pathKey(picked.path)
      return {
        occurrencePath: picked.path,
        kind: isBoard(picked.part)
          ? ((values.mounting[key] ?? usualMount(picked.part)) as MountKind)
          : 'none',
        connectorIds: (picked.part.connectors ?? [])
          .filter((connector) => values.ports[`${key}/${connector.id}`] === 'on')
          .map((connector) => connector.id),
      }
    })
    const editing = context.editing?.kind === 'enclosure' ? context.editing : null
    const feature: EnclosureFeature = {
      id: editing?.id ?? context.id('enclosure'),
      kind: 'enclosure',
      name: editing?.name ?? 'Enclosure',
      componentId: context.componentId,
      contextPath: componentInstance(context.doc, context.componentId)?.path ?? [],
      mounts,
      clearance: values.clearance,
      under: values.under,
      wall: values.wall,
      floor: values.floor,
      lid: values.lid as LidStyle,
      lidThickness: values.lidThickness,
      gap: values.gap,
      ...(isFitClass(values.fit) ? { fitClass: values.fit as FitClass } : {}),
      screw: Number(values.screw),
      tolerance: values.tolerance,
      bodyId: context.id('box'),
      lidBodyId: context.id('lid'),
    }
    return [feature]
  },
  adjust(doc, features, _context, values) {
    const feature = features.find((candidate) => candidate.kind === 'enclosure')
    if (!feature) return
    nameBody(doc, feature.bodyId, 'Enclosure')
    nameBody(doc, feature.lidBodyId, 'Enclosure Lid')
    linkFitClass(
      doc,
      feature.id,
      isFitClass(values.fit) ? (values.fit as FitClass) : undefined,
      values.gap,
    )
  },
})

export function enclosureValues(doc: OkcDocument, feature: EnclosureFeature) {
  const mounting: Record<string, string> = {}
  const ports: Record<string, string> = {}
  for (const mount of feature.mounts) {
    const key = pathKey(mount.occurrencePath)
    mounting[key] = mount.kind
    for (const id of mount.connectorIds) ports[`${key}/${id}`] = 'on'
  }
  return {
    parts: feature.mounts.flatMap(
      (mount) => occurrencePick(doc, mount.occurrencePath[mount.occurrencePath.length - 1]) ?? [],
    ),
    lid: feature.lid,
    screw: String(feature.screw),
    mounting,
    ports,
    tolerance: feature.tolerance,
    clearance: feature.clearance,
    under: feature.under,
    wall: feature.wall,
    floor: feature.floor,
    lidThickness: feature.lidThickness,
    fit: feature.fitClass ?? 'custom',
    gap: feature.gap,
  }
}
