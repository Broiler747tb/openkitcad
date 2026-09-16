import type { ComponentType, ReactNode, SVGProps } from 'react'

const INK = '#3c4652'
const BLUE = '#1676c5'
const ORANGE = '#e8792d'
const FACE = '#6fb3e8'
const GREEN = '#2b9348'
const RED = '#d9534f'

type IconProps = SVGProps<SVGSVGElement>

function frame(children: ReactNode) {
  return function SketchIcon(props: IconProps) {
    return (
      <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
        {children}
      </svg>
    )
  }
}

const dot = (x: number, y: number, colour = BLUE) => (
  <rect x={x - 2} y={y - 2} width={4} height={4} fill={colour} stroke="#ffffff" strokeWidth={0.6} />
)

const edge = { stroke: INK, strokeWidth: 1.8, strokeLinecap: 'round' as const }
const line = { ...edge, fill: 'none' }
const thin = { stroke: INK, strokeWidth: 1.2, strokeLinecap: 'round' as const, fill: 'none' }
const guide = { stroke: ORANGE, strokeWidth: 1.4, strokeDasharray: '3 2', fill: 'none' }

export const LineIcon = frame(
  <>
    <path d="M6 26L26 6" {...line} />
    {dot(6, 26)}
    {dot(26, 6)}
  </>,
)

export const RectangleIcon = frame(
  <>
    <rect x="6" y="9" width="20" height="14" fill={FACE} fillOpacity={0.35} {...edge} />
    {dot(6, 23)}
    {dot(26, 9)}
  </>,
)

export const CircleIcon = frame(
  <>
    <circle cx="16" cy="16" r="10" fill={FACE} fillOpacity={0.35} {...edge} />
    <path d="M16 16L23 9" {...guide} />
    {dot(16, 16)}
  </>,
)

export const ArcIcon = frame(
  <>
    <path d="M6 23A10 10 0 0 1 26 23" {...line} />
    <path d="M16 23L6 23M16 23L26 23" {...guide} />
    {dot(6, 23)}
    {dot(26, 23)}
    {dot(16, 23, ORANGE)}
  </>,
)

export const PolygonIcon = frame(
  <>
    <path
      d="M16 5L25.5 10.5L25.5 21.5L16 27L6.5 21.5L6.5 10.5Z"
      fill={FACE}
      fillOpacity={0.35}
      {...edge}
      strokeLinejoin="round"
    />
    {dot(16, 16)}
  </>,
)

export const SlotIcon = frame(
  <>
    <path
      d="M11 10H21A6 6 0 0 1 21 22H11A6 6 0 0 1 11 10Z"
      fill={FACE}
      fillOpacity={0.35}
      {...edge}
    />
    <path d="M11 16H21" {...guide} />
    {dot(11, 16)}
    {dot(21, 16)}
  </>,
)

export const SplineIcon = frame(
  <>
    <path d="M5 23C10 5 16 27 27 9" {...line} />
    {dot(5, 23)}
    {dot(15.5, 16)}
    {dot(27, 9)}
  </>,
)

export const EllipseIcon = frame(
  <>
    <ellipse cx="16" cy="16" rx="11" ry="7" fill={FACE} fillOpacity={0.35} {...edge} />
    <path d="M5 16H27" {...guide} />
    {dot(16, 16)}
  </>,
)

export const PointIcon = frame(
  <>
    <path d="M16 7V25M7 16H25" {...thin} strokeDasharray="2 2" />
    <rect x="12" y="12" width="8" height="8" fill={BLUE} stroke="#ffffff" strokeWidth={1} />
  </>,
)

export const SketchFilletIcon = frame(
  <>
    <path d="M6 26V16" {...line} />
    <path d="M16 6H26" {...line} />
    <path d="M6 16A10 10 0 0 1 16 6" stroke={ORANGE} strokeWidth={2} fill="none" />
    <path d="M6 6H16M6 6V16" {...thin} strokeDasharray="2 2" />
    {dot(6, 16)}
    {dot(16, 6)}
  </>,
)

export const TrimIcon = frame(
  <>
    <path d="M16 5V27" {...line} />
    <path d="M5 16H16" {...line} />
    <path d="M16 16H27" stroke={RED} strokeWidth={1.8} strokeDasharray="3 2" />
    <path d="M20 12L25 20M25 12L20 20" stroke={RED} strokeWidth={1.8} strokeLinecap="round" />
  </>,
)

export const ExtendIcon = frame(
  <>
    <path d="M26 5V27" {...line} />
    <path d="M5 16H13" {...line} />
    <path d="M13 16H22" stroke={BLUE} strokeWidth={1.8} strokeDasharray="3 2" />
    <path
      d="M19 12L24 16L19 20"
      stroke={BLUE}
      strokeWidth={1.8}
      fill="none"
      strokeLinejoin="round"
    />
    {dot(5, 16)}
  </>,
)

export const BreakIcon = frame(
  <>
    <path d="M5 16H13" {...line} />
    <path d="M19 16H27" {...line} />
    <path d="M13 11L16 21M16 11L19 21" stroke={ORANGE} strokeWidth={1.6} strokeLinecap="round" />
    {dot(13, 16)}
    {dot(19, 16)}
  </>,
)

export const OffsetIcon = frame(
  <>
    <rect x="4" y="7" width="24" height="18" rx="5" {...line} />
    <rect x="9" y="12" width="14" height="8" rx="1.5" stroke={BLUE} strokeWidth={1.8} fill="none" />
    <path d="M16 7V12" stroke={ORANGE} strokeWidth={1.2} />
  </>,
)

export const MoveCopyIcon = frame(
  <>
    <path d="M16 4V28M4 16H28" stroke={INK} strokeWidth={1.8} />
    <path
      d="M12 8L16 4L20 8M12 24L16 28L20 24M8 12L4 16L8 20M24 12L28 16L24 20"
      stroke={BLUE}
      strokeWidth={1.8}
      fill="none"
      strokeLinejoin="round"
    />
  </>,
)

export const SketchScaleIcon = frame(
  <>
    <rect x="5" y="15" width="12" height="12" {...line} />
    <rect
      x="5"
      y="5"
      width="22"
      height="22"
      stroke={BLUE}
      strokeWidth={1.4}
      strokeDasharray="3 2"
      fill="none"
    />
    <path
      d="M17 15L25 7M20 7H25V12"
      stroke={ORANGE}
      strokeWidth={1.6}
      fill="none"
      strokeLinecap="round"
    />
  </>,
)

export const SketchMirrorIcon = frame(
  <>
    <path d="M16 4V28" {...guide} />
    <path d="M13 9L5 23H13Z" fill={FACE} fillOpacity={0.35} {...edge} strokeLinejoin="round" />
    <path
      d="M19 9L27 23H19Z"
      fill={FACE}
      fillOpacity={0.6}
      stroke={BLUE}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  </>,
)

export const SketchCircularPatternIcon = frame(
  <>
    <circle cx="16" cy="16" r="9" {...guide} />
    {[0, 1, 2, 3, 4, 5].map((k) => {
      const a = (k / 6) * Math.PI * 2
      return (
        <circle
          key={k}
          cx={16 + 9 * Math.cos(a)}
          cy={16 + 9 * Math.sin(a)}
          r={2.6}
          fill={k === 0 ? FACE : '#ffffff'}
          stroke={k === 0 ? INK : BLUE}
          strokeWidth={1.4}
        />
      )
    })}
    {dot(16, 16)}
  </>,
)

export const SketchRectangularPatternIcon = frame(
  <>
    {[0, 1, 2].map((i) =>
      [0, 1].map((j) => (
        <rect
          key={`${i}-${j}`}
          x={4 + i * 9}
          y={8 + j * 9}
          width={6}
          height={6}
          fill={i === 0 && j === 0 ? FACE : '#ffffff'}
          stroke={i === 0 && j === 0 ? INK : BLUE}
          strokeWidth={1.4}
        />
      )),
    )}
  </>,
)

export const ProjectIcon = frame(
  <>
    <path
      d="M9 5L23 5L27 11L13 11Z"
      fill="#c9d0d7"
      stroke={INK}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
    <path
      d="M5 20L19 20L27 27L13 27Z"
      fill={FACE}
      fillOpacity={0.35}
      stroke={INK}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
    <path
      d="M11 22H21L25 25H15Z"
      stroke={BLUE}
      strokeWidth={1.6}
      fill="none"
      strokeLinejoin="round"
    />
    <path
      d="M18 11V19M15 16L18 19L21 16"
      stroke={ORANGE}
      strokeWidth={1.6}
      fill="none"
      strokeLinecap="round"
    />
  </>,
)

export const SketchDimensionIcon = frame(
  <>
    <path d="M6 24V10M26 24V10" {...thin} />
    <path d="M6 14H26" stroke={BLUE} strokeWidth={1.6} />
    <path
      d="M10 11L6 14L10 17M22 11L26 14L22 17"
      stroke={BLUE}
      strokeWidth={1.6}
      fill="none"
      strokeLinejoin="round"
    />
    <rect x="11" y="18" width="10" height="7" rx="1" fill="#ffffff" stroke={INK} strokeWidth={1} />
    <path d="M14 21.5H18" stroke={INK} strokeWidth={1.2} />
  </>,
)

export const FinishSketchIcon = frame(
  <>
    <rect
      x="4"
      y="4"
      width="24"
      height="24"
      rx="4"
      fill={GREEN}
      fillOpacity={0.15}
      stroke={GREEN}
      strokeWidth={1.6}
    />
    <path
      d="M9 16L14 21L23 11"
      stroke={GREEN}
      strokeWidth={3}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>,
)

export const CreateSketchIcon = frame(
  <>
    <path
      d="M3 20L13 12L29 12L19 20Z"
      fill={FACE}
      fillOpacity={0.35}
      stroke={INK}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
    <path d="M9 17H18" {...line} />
    <path
      d="M19 9L26 2L29 5L22 12L18 13Z"
      fill="#f2c14e"
      stroke={INK}
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  </>,
)

export const ConstructionIcon = frame(
  <>
    <path
      d="M5 27L27 5"
      stroke={ORANGE}
      strokeWidth={2}
      strokeDasharray="4 3"
      strokeLinecap="round"
    />
    {dot(5, 27, ORANGE)}
    {dot(27, 5, ORANGE)}
  </>,
)

export const PlaneIcon = frame(
  <>
    <path
      d="M3 22L11 9L29 9L21 22Z"
      fill={FACE}
      fillOpacity={0.45}
      stroke={BLUE}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
    <path d="M16 15V26M13 23L16 26L19 23" stroke={ORANGE} strokeWidth={1.6} fill="none" />
  </>,
)

export const MeasureIcon = frame(
  <>
    <path
      d="M4 21L21 4L28 11L11 28Z"
      fill="#f2c14e"
      stroke={INK}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
    <path d="M9 17L12 20M13 13L15 15M17 9L20 12M21 5L23 7" stroke={INK} strokeWidth={1.2} />
  </>,
)

export const HardwareIcon = frame(
  <>
    <rect
      x="4"
      y="8"
      width="24"
      height="16"
      rx="1.5"
      fill={GREEN}
      fillOpacity={0.75}
      stroke={INK}
      strokeWidth={1.2}
    />
    <circle cx="7.5" cy="11.5" r="1.6" fill="#ffffff" stroke={INK} strokeWidth={0.8} />
    <circle cx="24.5" cy="20.5" r="1.6" fill="#ffffff" stroke={INK} strokeWidth={0.8} />
    <rect x="12" y="12" width="8" height="8" fill="#2c3238" />
    <path
      d="M13 11V9M16 11V9M19 11V9M13 23V21M16 23V21M19 23V21"
      stroke="#c9d0d7"
      strokeWidth={1}
    />
  </>,
)

export const SelectIcon = frame(
  <>
    <path
      d="M8 4L8 25L13 20L17 28L20 26.5L16 18.5L23 18.5Z"
      fill="#ffffff"
      stroke={INK}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </>,
)

export const InspectIcon = frame(
  <>
    <circle cx="13" cy="13" r="8" fill={FACE} fillOpacity={0.35} stroke={INK} strokeWidth={1.8} />
    <path d="M19 19L27 27" stroke={INK} strokeWidth={3} strokeLinecap="round" />
  </>,
)

const small = (children: ReactNode) => frame(children)

export const CONSTRAINT_ICONS: Record<string, ComponentType<IconProps>> = {
  horizontalVertical: small(
    <>
      <path d="M5 22H27" {...line} />
      <path d="M22 5V27" {...line} />
      {dot(5, 22)}
      {dot(22, 5)}
    </>,
  ),
  coincident: small(
    <>
      <path d="M5 26L16 16L27 26" {...line} />
      <rect x="12" y="12" width="8" height="8" fill={BLUE} stroke="#ffffff" strokeWidth={1} />
    </>,
  ),
  tangent: small(
    <>
      <circle cx="16" cy="19" r="8" {...line} />
      <path d="M3 11H29" stroke={BLUE} strokeWidth={1.8} />
    </>,
  ),
  equal: small(
    <>
      <path d="M6 10H26M6 22H26" {...line} />
      <path d="M12 14.5H20M12 17.5H20" stroke={BLUE} strokeWidth={1.6} />
    </>,
  ),
  parallel: small(
    <>
      <path d="M8 26L18 6M16 26L26 6" {...line} />
    </>,
  ),
  perpendicular: small(
    <>
      <path d="M6 26H26M16 26V6" {...line} />
      <path d="M16 21H21V26" stroke={BLUE} strokeWidth={1.4} fill="none" />
    </>,
  ),
  fix: small(
    <>
      <rect
        x="8"
        y="14"
        width="16"
        height="12"
        rx="2"
        fill="#f2c14e"
        stroke={INK}
        strokeWidth={1.4}
      />
      <path d="M11 14V10A5 5 0 0 1 21 10V14" stroke={INK} strokeWidth={1.8} fill="none" />
    </>,
  ),
  midpoint: small(
    <>
      <path d="M4 22H28" {...line} />
      <path d="M16 12L21 20H11Z" fill={BLUE} stroke="#ffffff" strokeWidth={0.8} />
      {dot(4, 22)}
      {dot(28, 22)}
    </>,
  ),
  concentric: small(
    <>
      <circle cx="16" cy="16" r="11" {...line} />
      <circle cx="16" cy="16" r="5" stroke={BLUE} strokeWidth={1.8} fill="none" />
    </>,
  ),
  collinear: small(
    <>
      <path d="M4 24L13 16" {...line} />
      <path d="M19 11L28 3" {...line} />
      <path d="M13 16L19 11" stroke={BLUE} strokeWidth={1.4} strokeDasharray="2 2" />
    </>,
  ),
  symmetry: small(
    <>
      <path d="M16 3V29" {...guide} />
      <rect x="4" y="12" width="7" height="7" fill={BLUE} stroke="#ffffff" strokeWidth={0.8} />
      <rect x="21" y="12" width="7" height="7" fill={BLUE} stroke="#ffffff" strokeWidth={0.8} />
    </>,
  ),
  smooth: small(
    <>
      <path d="M4 24C12 24 12 8 20 8H28" {...line} />
      <circle cx="16" cy="16" r="2.4" fill={BLUE} />
    </>,
  ),
}

export const SKETCH_MENU_ICONS: Record<string, ComponentType<IconProps>> = {
  Line: LineIcon,
  Rectangle: RectangleIcon,
  Circle: CircleIcon,
  Arc: ArcIcon,
  Polygon: PolygonIcon,
  Ellipse: EllipseIcon,
  Slot: SlotIcon,
  Spline: SplineIcon,
  Point: PointIcon,
}
