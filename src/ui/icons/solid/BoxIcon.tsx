import type { SVGProps } from 'react'

export function BoxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="4.74,22.5 16,29 16,16 4.74,9.5"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="27.26,22.5 16,29 16,16 27.26,9.5"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,3 27.26,9.5 16,16 4.74,9.5"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
