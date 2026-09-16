import type { SVGProps } from 'react'

export function SplitFaceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3,21.2 16,28.7 16,18.31 3,10.8"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,21.2 16,28.7 16,18.31 29,10.8"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,3.3 29,10.8 16,18.31 3,10.8"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="22.5,7.05 29,10.8 16,18.31 9.5,14.56"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="22.5,7.05 29,10.8 16,18.31 9.5,14.56"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="24.5"
        y1="5.9"
        x2="7.5"
        y2="15.71"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}
