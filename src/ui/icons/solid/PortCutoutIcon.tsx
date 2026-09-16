import type { SVGProps } from 'react'

export function PortCutoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="5.94,19.04 23.19,29 23.19,14.62 5.94,4.66"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="26.06,27.34 23.19,29 23.19,14.62 26.06,12.96"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="8.81,3 26.06,12.96 23.19,14.62 5.94,4.66"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon points="10.73,16.83 18.4,21.26 18.4,16.83 10.73,12.4" fill="#3c4652" />
      <polygon points="13.6,15.17 21.27,19.6 18.4,21.26 10.73,16.83" fill="#c9d0d7" />
      <polygon points="13.6,15.17 10.73,16.83 10.73,12.4 13.6,10.74" fill="#8a949e" />
      <polygon
        points="10.73,16.83 18.4,21.26 18.4,16.83 10.73,12.4"
        fill="none"
        stroke="#d9534f"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
