import type { FitClass, OkcDocument, SnapFitFeature, SnapMaterial } from './types'

export const FIT_CLASSES: ReadonlyArray<{
  value: FitClass
  label: string
  hint: string
  preference: 'fitPress' | 'fitSnug' | 'fitSliding' | 'fitLoose'
}> = [
  {
    value: 'press',
    label: 'Press',
    hint: 'Pushed together by hand and stays put. For pins and parts that should not move.',
    preference: 'fitPress',
  },
  {
    value: 'snug',
    label: 'Snug',
    hint: 'Goes together without force and does not rattle. For snaps, lips and lids.',
    preference: 'fitSnug',
  },
  {
    value: 'sliding',
    label: 'Sliding',
    hint: 'Moves freely along its guide. For dovetails, bayonets and sliding covers.',
    preference: 'fitSliding',
  },
  {
    value: 'loose',
    label: 'Loose',
    hint: 'Clear all round. For parts printed already assembled, like hinges.',
    preference: 'fitLoose',
  },
]

export function isFitClass(value: unknown): value is FitClass {
  return FIT_CLASSES.some((fit) => fit.value === value)
}

export function fitParameterName(fit: FitClass): string {
  return `fit_${fit}`
}

export function fitParameterGap(doc: OkcDocument, fit: FitClass): number | undefined {
  const parameter = doc.parameters.find((p) => p.name === fitParameterName(fit))
  return parameter && Number.isFinite(parameter.value) ? parameter.value : undefined
}

export function linkFitClass(
  doc: OkcDocument,
  featureId: string,
  fit: FitClass | undefined,
  printerGap: number,
  field = 'gap',
): void {
  const classNames = FIT_CLASSES.map((candidate) => fitParameterName(candidate.value))
  doc.bindings = doc.bindings.filter(
    (binding) =>
      !(
        binding.featureId === featureId &&
        binding.field === field &&
        (fit || classNames.includes(binding.expression.trim()))
      ),
  )
  if (!fit) return
  const name = fitParameterName(fit)
  if (!doc.parameters.some((p) => p.name === name)) {
    const label = FIT_CLASSES.find((candidate) => candidate.value === fit)!.label
    doc.parameters.push({
      id: `param-${name}`,
      name,
      value: printerGap,
      expression: `${printerGap} mm`,
      comment: `${label} fit: gap per side`,
    })
  }
  doc.bindings.push({ featureId, field, expression: name })
}

export const SNAP_MATERIALS: ReadonlyArray<{
  value: SnapMaterial
  label: string
  strain: number
  hint: string
}> = [
  {
    value: 'pla',
    label: 'PLA',
    strain: 0.02,
    hint: 'Stiff and brittle. Hooks need long, thin arms.',
  },
  { value: 'petg', label: 'PETG', strain: 0.04, hint: 'Bends about twice as far as PLA.' },
  { value: 'abs', label: 'ABS or ASA', strain: 0.03, hint: 'Between PLA and PETG.' },
  { value: 'nylon', label: 'Nylon', strain: 0.06, hint: 'Tough and flexible. The most forgiving.' },
]

export const SNAP_LEAD_ANGLE = 30

export const SNAP_LAND = 0.4

export type SnapShape = Pick<SnapFitFeature, 'length' | 'thickness' | 'hookDepth' | 'retention'>

export function snapHookLength(snap: Pick<SnapFitFeature, 'hookDepth' | 'retention'>): number {
  const lead = snap.hookDepth / Math.tan((SNAP_LEAD_ANGLE * Math.PI) / 180)
  const back = snap.retention === 'removable' ? snap.hookDepth : 0
  return lead + SNAP_LAND + back
}

export function snapStrain(snap: SnapShape): number {
  const arm = Math.max(snap.length - snapHookLength(snap), 1e-6)
  return (1.5 * snap.thickness * snap.hookDepth) / (arm * arm)
}

export function snapStrainLimit(material: SnapMaterial): number {
  return SNAP_MATERIALS.find((entry) => entry.value === material)?.strain ?? 0.02
}

export function shortestSnapArm(
  snap: Pick<SnapFitFeature, 'thickness' | 'hookDepth' | 'retention' | 'material'>,
): number {
  const arm = Math.sqrt((1.5 * snap.thickness * snap.hookDepth) / snapStrainLimit(snap.material))
  return arm + snapHookLength(snap)
}
