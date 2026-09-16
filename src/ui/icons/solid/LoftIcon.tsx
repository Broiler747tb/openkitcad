import type { SVGProps } from 'react'

export function LoftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="4.09,22.12 10.84,5.28 11.07,4.9 11.38,4.55 11.77,4.2 12.23,3.91 12.76,3.64 13.33,3.41 13.96,3.24 14.62,3.1 15.3,3.03 16,3 16.7,3.03 17.38,3.1 18.04,3.24 18.67,3.41 19.24,3.64 19.77,3.91 20.23,4.2 20.62,4.55 20.93,4.9 21.16,5.28 27.91,22.12 16,29"
        fill="#6fb3e8"
        fillOpacity={0.35}
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M16 15.25L27.91 22.12L16 29L4.09 22.12Z"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <ellipse
        cx="16"
        cy="6.08"
        rx="5.33"
        ry="3.08"
        fill="none"
        stroke="#1676c5"
        strokeWidth={1.8}
      />
    </svg>
  )
}
