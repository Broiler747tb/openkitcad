import type { SVGProps } from 'react'

export function VentPatternIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3,17.41 16,24.91 16,22.1 3,14.59"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,17.41 16,24.91 16,22.1 29,14.59"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,7.09 29,14.59 16,22.1 3,14.59"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="16.4"
        y1="10.61"
        x2="9.1"
        y2="14.83"
        stroke="#3c4652"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <line
        x1="18.84"
        y1="12.01"
        x2="11.54"
        y2="16.23"
        stroke="#3c4652"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <line
        x1="21.28"
        y1="13.42"
        x2="13.96"
        y2="17.64"
        stroke="#3c4652"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <line
        x1="23.72"
        y1="14.83"
        x2="16.4"
        y2="19.05"
        stroke="#3c4652"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  )
}
