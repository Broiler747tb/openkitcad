import type { SVGProps } from 'react'

export function SphereIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <circle cx="16" cy="16" r="13" fill="#a9b2bb" />
      <path d="M4.82 22.63A13 13 0 1 0 22.63 4.82A12.74 12.74 0 0 1 4.82 22.63Z" fill="#8a949e" />
      <ellipse cx="12.1" cy="11.84" rx="5.98" ry="4.68" fill="#c9d0d7" />
      <circle cx="16" cy="16" r="13" fill="none" stroke="#3c4652" strokeWidth={1.2} />
      <path
        d="M29 16A13 4.55 0 0 1 3 16"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
