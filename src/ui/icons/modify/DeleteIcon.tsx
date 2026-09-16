import type { SVGProps } from 'react'

export function DeleteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3.47,18.5 13,24 13,13 3.47,7.5"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="22.53,18.5 13,24 13,13 22.53,7.5"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="13,2 22.53,7.5 13,13 3.47,7.5"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line
        x1="19.5"
        y1="19.5"
        x2="28.5"
        y2="28.5"
        stroke="#d9534f"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1="28.5"
        y1="19.5"
        x2="19.5"
        y2="28.5"
        stroke="#d9534f"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  )
}
