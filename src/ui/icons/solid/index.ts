import type { ComponentType, SVGProps } from 'react'
import { ExtrudeIcon } from './ExtrudeIcon'
import { RevolveIcon } from './RevolveIcon'
import { SweepIcon } from './SweepIcon'
import { LoftIcon } from './LoftIcon'
import { RibIcon } from './RibIcon'
import { WebIcon } from './WebIcon'
import { EmbossIcon } from './EmbossIcon'
import { HoleIcon } from './HoleIcon'
import { ThreadIcon } from './ThreadIcon'
import { BoxIcon } from './BoxIcon'
import { CylinderIcon } from './CylinderIcon'
import { SphereIcon } from './SphereIcon'
import { TorusIcon } from './TorusIcon'
import { CoilIcon } from './CoilIcon'
import { PipeIcon } from './PipeIcon'
import { RectangularPatternIcon } from './RectangularPatternIcon'
import { CircularPatternIcon } from './CircularPatternIcon'
import { PatternOnPathIcon } from './PatternOnPathIcon'
import { MirrorIcon } from './MirrorIcon'
import { ThickenIcon } from './ThickenIcon'
import { BoundaryFillIcon } from './BoundaryFillIcon'
import { MountingHolesIcon } from './MountingHolesIcon'
import { StandoffIcon } from './StandoffIcon'
import { PortCutoutIcon } from './PortCutoutIcon'
import { VentPatternIcon } from './VentPatternIcon'
import { LidIcon } from './LidIcon'
import { LidSeatIcon } from './LidSeatIcon'

export {
  ExtrudeIcon,
  RevolveIcon,
  SweepIcon,
  LoftIcon,
  RibIcon,
  WebIcon,
  EmbossIcon,
  HoleIcon,
  ThreadIcon,
  BoxIcon,
  CylinderIcon,
  SphereIcon,
  TorusIcon,
  CoilIcon,
  PipeIcon,
  RectangularPatternIcon,
  CircularPatternIcon,
  PatternOnPathIcon,
  MirrorIcon,
  ThickenIcon,
  BoundaryFillIcon,
  MountingHolesIcon,
  StandoffIcon,
  PortCutoutIcon,
  VentPatternIcon,
  LidIcon,
  LidSeatIcon,
}

export const ICONS: {
  id: string
  label: string
  component: ComponentType<SVGProps<SVGSVGElement>>
}[] = [
  { id: 'extrude', label: 'Extrude', component: ExtrudeIcon },
  { id: 'revolve', label: 'Revolve', component: RevolveIcon },
  { id: 'sweep', label: 'Sweep', component: SweepIcon },
  { id: 'loft', label: 'Loft', component: LoftIcon },
  { id: 'rib', label: 'Rib', component: RibIcon },
  { id: 'web', label: 'Web', component: WebIcon },
  { id: 'emboss', label: 'Emboss', component: EmbossIcon },
  { id: 'hole', label: 'Hole', component: HoleIcon },
  { id: 'thread', label: 'Thread', component: ThreadIcon },
  { id: 'box', label: 'Box', component: BoxIcon },
  { id: 'cylinder', label: 'Cylinder', component: CylinderIcon },
  { id: 'sphere', label: 'Sphere', component: SphereIcon },
  { id: 'torus', label: 'Torus', component: TorusIcon },
  { id: 'coil', label: 'Coil', component: CoilIcon },
  { id: 'pipe', label: 'Pipe', component: PipeIcon },
  { id: 'rectangular-pattern', label: 'Rectangular Pattern', component: RectangularPatternIcon },
  { id: 'circular-pattern', label: 'Circular Pattern', component: CircularPatternIcon },
  { id: 'pattern-on-path', label: 'Pattern on Path', component: PatternOnPathIcon },
  { id: 'mirror', label: 'Mirror', component: MirrorIcon },
  { id: 'thicken', label: 'Thicken', component: ThickenIcon },
  { id: 'boundary-fill', label: 'Boundary Fill', component: BoundaryFillIcon },
  { id: 'mounting-holes', label: 'Mounting Holes', component: MountingHolesIcon },
  { id: 'standoff', label: 'Standoff', component: StandoffIcon },
  { id: 'port-cutout', label: 'Port Cutout', component: PortCutoutIcon },
  { id: 'vent-pattern', label: 'Vent Pattern', component: VentPatternIcon },
  { id: 'lid', label: 'Lid', component: LidIcon },
  { id: 'lid-seat', label: 'Lid Seat', component: LidSeatIcon },
]
