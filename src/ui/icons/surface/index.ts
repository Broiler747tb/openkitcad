import type { ComponentType, SVGProps } from 'react'
import { SurfaceExtrudeIcon } from './SurfaceExtrudeIcon'
import { SurfaceRevolveIcon } from './SurfaceRevolveIcon'
import { PatchIcon } from './PatchIcon'
import { OffsetSurfaceIcon } from './OffsetSurfaceIcon'
import { StitchIcon } from './StitchIcon'
import { UnstitchIcon } from './UnstitchIcon'
import { SurfaceReverseNormalIcon } from './SurfaceReverseNormalIcon'

export {
  SurfaceExtrudeIcon,
  SurfaceRevolveIcon,
  PatchIcon,
  OffsetSurfaceIcon,
  StitchIcon,
  UnstitchIcon,
  SurfaceReverseNormalIcon,
}

export const ICONS: {
  id: string
  label: string
  component: ComponentType<SVGProps<SVGSVGElement>>
}[] = [
  { id: 'surface-extrude', label: 'Extrude', component: SurfaceExtrudeIcon },
  { id: 'surface-revolve', label: 'Revolve', component: SurfaceRevolveIcon },
  { id: 'patch', label: 'Patch', component: PatchIcon },
  { id: 'offset-surface', label: 'Offset', component: OffsetSurfaceIcon },
  { id: 'stitch', label: 'Stitch', component: StitchIcon },
  { id: 'unstitch', label: 'Unstitch', component: UnstitchIcon },
  { id: 'surface-reverse-normal', label: 'Reverse Normal', component: SurfaceReverseNormalIcon },
]
