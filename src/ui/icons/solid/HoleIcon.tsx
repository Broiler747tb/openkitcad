import type { SVGProps } from 'react'

export function HoleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="3.88,22 16,29 16,23 3.88,16"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="28.12,22 16,29 16,23 28.12,16"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,9 28.12,16 16,23 3.88,16"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse cx="16" cy="16" rx="4.41" ry="2.55" fill="#3c4652" />
      <path d="M12.11 17.2A4.41 2.55 0 1 1 19.89 17.2A4.41 2.55 0 0 0 12.11 17.2Z" fill="#8a949e" />
      <ellipse cx="16" cy="16" rx="4.41" ry="2.55" fill="none" stroke="#3c4652" strokeWidth={1.2} />
      <line
        x1="16"
        y1="3"
        x2="16"
        y2="11.8"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,15 13.77,11.4 18.23,11.4"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
