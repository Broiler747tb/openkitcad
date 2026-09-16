import type { SVGProps } from 'react'

export function AppearanceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <circle cx="13.5" cy="18.5" r="10.5" fill="#6fb3e8" />
      <path
        d="M4.47 23.85A10.5 10.5 0 1 0 18.85 9.47A10.29 10.29 0 0 1 4.47 23.85Z"
        fill="#1676c5"
      />
      <ellipse cx="10.35" cy="15.14" rx="4.83" ry="3.78" fill="#ffffff" />
      <circle cx="13.5" cy="18.5" r="10.5" fill="none" stroke="#3c4652" strokeWidth={1.2} />
      <path
        d="M25 2.5C25 2.5 29.5 8 29.5 10.5A4.5 4.5 0 0 1 20.5 10.5C20.5 8 25 2.5 25 2.5Z"
        fill="#1676c5"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
