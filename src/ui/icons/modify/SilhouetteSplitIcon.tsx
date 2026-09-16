import type { SVGProps } from 'react'

export function SilhouetteSplitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <circle cx="16" cy="19.5" r="10" fill="#a9b2bb" />
      <path d="M7.4 24.6A10 10 0 1 0 21.1 10.9A9.8 9.8 0 0 1 7.4 24.6Z" fill="#8a949e" />
      <ellipse cx="13" cy="16.3" rx="4.6" ry="3.6" fill="#c9d0d7" />
      <circle cx="16" cy="19.5" r="10" fill="none" stroke="#3c4652" strokeWidth={1.2} />
      <path
        d="M6 19.5A10 5.77 0 0 1 26 19.5"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <path
        d="M26 19.5A10 5.77 0 0 1 6 19.5"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="1.5"
        x2="16"
        y2="5.5"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="16,8.5 13.89,5.1 18.11,5.1"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
