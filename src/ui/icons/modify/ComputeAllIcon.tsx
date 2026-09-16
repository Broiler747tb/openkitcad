import type { SVGProps } from 'react'

export function ComputeAllIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="8.64,20.25 16,24.5 16,16 8.64,11.75"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="23.36,20.25 16,24.5 16,16 23.36,11.75"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,7.5 23.36,11.75 16,16 8.64,11.75"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M4.25 11.72A12.5 12.5 0 0 1 25.23 7.58"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points="26.83,9.75 22.8,8.42 26.23,5.56"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path
        d="M27.75 20.28A12.5 12.5 0 0 1 6.77 24.42"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points="5.17,22.25 9.2,23.58 5.77,26.44"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
