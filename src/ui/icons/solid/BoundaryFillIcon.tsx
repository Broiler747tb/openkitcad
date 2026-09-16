import type { SVGProps } from 'react'

export function BoundaryFillIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="22.5,17.34 9.5,24.85 9.5,10.91 22.5,3.4"
        fill="#9fd0f0"
        fillOpacity={0.5}
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="9.5,24.85 16,28.6 16,22.17 9.5,18.41"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,21.09 16,28.6 16,22.17 29,14.66"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="22.5,10.91 29,14.66 16,22.17 9.5,18.41"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,7.15 29,14.66 16,22.17 3,14.66"
        fill="#9fd0f0"
        fillOpacity={0.5}
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
