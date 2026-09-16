import type { ComponentType, SVGProps } from 'react'
import { PressPullIcon } from './PressPullIcon'
import { FilletIcon } from './FilletIcon'
import { RuleFilletIcon } from './RuleFilletIcon'
import { FullRoundFilletIcon } from './FullRoundFilletIcon'
import { ChamferIcon } from './ChamferIcon'
import { ShellIcon } from './ShellIcon'
import { DraftIcon } from './DraftIcon'
import { ScaleIcon } from './ScaleIcon'
import { CombineIcon } from './CombineIcon'
import { OffsetFaceIcon } from './OffsetFaceIcon'
import { SplitFaceIcon } from './SplitFaceIcon'
import { SplitBodyIcon } from './SplitBodyIcon'
import { SilhouetteSplitIcon } from './SilhouetteSplitIcon'
import { MoveCopyIcon } from './MoveCopyIcon'
import { AlignIcon } from './AlignIcon'
import { DeleteIcon } from './DeleteIcon'
import { PhysicalMaterialIcon } from './PhysicalMaterialIcon'
import { AppearanceIcon } from './AppearanceIcon'
import { ChangeParametersIcon } from './ChangeParametersIcon'
import { ComputeAllIcon } from './ComputeAllIcon'

export {
  PressPullIcon,
  FilletIcon,
  RuleFilletIcon,
  FullRoundFilletIcon,
  ChamferIcon,
  ShellIcon,
  DraftIcon,
  ScaleIcon,
  CombineIcon,
  OffsetFaceIcon,
  SplitFaceIcon,
  SplitBodyIcon,
  SilhouetteSplitIcon,
  MoveCopyIcon,
  AlignIcon,
  DeleteIcon,
  PhysicalMaterialIcon,
  AppearanceIcon,
  ChangeParametersIcon,
  ComputeAllIcon,
}

export const ICONS: {
  id: string
  label: string
  component: ComponentType<SVGProps<SVGSVGElement>>
}[] = [
  { id: 'press-pull', label: 'Press Pull', component: PressPullIcon },
  { id: 'fillet', label: 'Fillet', component: FilletIcon },
  { id: 'rule-fillet', label: 'Rule Fillet', component: RuleFilletIcon },
  { id: 'full-round-fillet', label: 'Full Round Fillet', component: FullRoundFilletIcon },
  { id: 'chamfer', label: 'Chamfer', component: ChamferIcon },
  { id: 'shell', label: 'Shell', component: ShellIcon },
  { id: 'draft', label: 'Draft', component: DraftIcon },
  { id: 'scale', label: 'Scale', component: ScaleIcon },
  { id: 'combine', label: 'Combine', component: CombineIcon },
  { id: 'offset-face', label: 'Offset Face', component: OffsetFaceIcon },
  { id: 'split-face', label: 'Split Face', component: SplitFaceIcon },
  { id: 'split-body', label: 'Split Body', component: SplitBodyIcon },
  { id: 'silhouette-split', label: 'Silhouette Split', component: SilhouetteSplitIcon },
  { id: 'move-copy', label: 'Move Copy', component: MoveCopyIcon },
  { id: 'align', label: 'Align', component: AlignIcon },
  { id: 'delete', label: 'Delete', component: DeleteIcon },
  { id: 'physical-material', label: 'Physical Material', component: PhysicalMaterialIcon },
  { id: 'appearance', label: 'Appearance', component: AppearanceIcon },
  { id: 'change-parameters', label: 'Change Parameters', component: ChangeParametersIcon },
  { id: 'compute-all', label: 'Compute All', component: ComputeAllIcon },
]
