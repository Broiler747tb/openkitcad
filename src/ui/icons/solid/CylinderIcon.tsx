import type { SVGProps } from 'react'

export function CylinderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <path d="M6.68 8.38L6.68 23.62A9.32 5.38 0 0 0 25.32 23.62L25.32 8.38Z" fill="#a9b2bb" />
      <path d="M16 13.77L16 29A9.32 5.38 0 0 0 25.32 23.62L25.32 8.38Z" fill="#8a949e" />
      <path
        d="M6.68 8.38L6.68 23.62A9.32 5.38 0 0 0 25.32 23.62L25.32 8.38Z"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <ellipse
        cx="16"
        cy="8.38"
        rx="9.32"
        ry="5.38"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
      />
    </svg>
  )
}
