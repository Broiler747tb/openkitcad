import type { SVGProps } from 'react'

export function RuleFilletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3,13.67 3.14,12.84 3.56,12.03 4.24,11.29 5.17,10.64 16,4.38 26.83,10.64 27.76,11.29 28.44,12.03 28.86,12.84 29,13.67 29,20.11 16,27.62 3,20.11"
        fill="#c9d0d7"
      />
      <polygon
        points="3,13.67 3.14,12.84 3.56,12.03 4.24,11.29 5.17,10.64 16,4.38 26.83,10.64 27.76,11.29 28.44,12.03 28.86,12.84 29,13.67 29,20.11 16,27.62 3,20.11"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="3,20.11 16,27.62 16,21.18 3,13.67"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29,20.11 16,27.62 16,21.18 29,13.67"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,6.16 21.58,9.38 16,12.6 10.42,9.38"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polyline
        points="16,21.18 16,20.26 16,19.21 16,18.07 16,16.89 16,15.71 16,14.57 16,13.52 16,12.6"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
