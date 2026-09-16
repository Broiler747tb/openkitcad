import type { SVGProps } from 'react'

export function RevolveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <line
        x1="19.14"
        y1="28.34"
        x2="19.14"
        y2="3.03"
        stroke="#1676c5"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <path
        d="M22.95 25.16A14.73 8.51 0 0 1 5.7 13.48"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points="7.86,11.48 6.99,16.47 3,12.91"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path
        d="M22.43 25.18L29 28.97L29 15.05L22.43 11.25Z"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
