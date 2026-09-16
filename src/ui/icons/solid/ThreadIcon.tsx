import type { SVGProps } from 'react'

export function ThreadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <path d="M8.78 7.16L8.78 24.84A7.22 4.16 0 0 0 23.22 24.84L23.22 7.16Z" fill="#a9b2bb" />
      <path d="M16 11.33L16 29A7.22 4.16 0 0 0 23.22 24.84L23.22 7.16Z" fill="#8a949e" />
      <path
        d="M8.78 7.16L8.78 24.84A7.22 4.16 0 0 0 23.22 24.84L23.22 7.16Z"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <ellipse
        cx="16"
        cy="7.16"
        rx="7.22"
        ry="4.16"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
      />
      <path
        d="M8.78 23.36C8.78 28.92 23.22 27.35 23.22 21.79"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M8.78 20.42C8.78 25.98 23.22 24.4 23.22 18.85"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M8.78 17.47C8.78 23.03 23.22 21.46 23.22 15.9"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M8.78 14.53C8.78 20.08 23.22 18.51 23.22 12.96"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M8.78 11.58C8.78 17.14 23.22 15.57 23.22 10.01"
        fill="none"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
