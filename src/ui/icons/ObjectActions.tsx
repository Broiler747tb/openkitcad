import type { SVGProps } from 'react'

export function MoveObjectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} fill="none" {...props}>
      <path
        d="m16 11 4.5 2.6v5.2L16 21.4l-4.5-2.6v-5.2Z"
        fill="#a9b2bb"
        stroke="#657381"
        strokeLinejoin="round"
      />
      <path d="m11.5 13.6 4.5 2.6 4.5-2.6M16 16.2v5.2" stroke="#657381" strokeLinejoin="round" />
      <g stroke="#e8792d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 9V2.5m-3 3 3-3 3 3M16 23v6.5m-3-3 3 3 3-3M9 16H2.5m3-3-3 3 3 3M23 16h6.5m-3-3 3 3-3 3" />
      </g>
    </svg>
  )
}

export function RotateObjectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} fill="none" {...props}>
      <path
        d="m16 9 6 3.5v7L16 23l-6-3.5v-7Z"
        fill="#a9b2bb"
        stroke="#657381"
        strokeLinejoin="round"
      />
      <path d="m10 12.5 6 3.5 6-3.5M16 16v7" stroke="#657381" strokeLinejoin="round" />
      <g stroke="#e8792d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 10a12 12 0 0 1 22 0m-5-1 5 1 1-5M27 22A12 12 0 0 1 5 22m5 1-5-1-1 5" />
      </g>
    </svg>
  )
}

export function HoleObjectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} fill="none" {...props}>
      <path d="m16 3 11 6.5v13L16 29 5 22.5v-13Z" fill="#e8792d" fillOpacity="0.1" />
      <g stroke="#a9b2bb" strokeWidth="1.2" strokeLinecap="round" opacity="0.65">
        <path d="m8 13 5 3m-5 2 5 3m0-8 6-3m-2 6 7-4m-7 9 7-4m-7 9 7-4" />
      </g>
      <g
        stroke="#e8792d"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2.5 2.5"
      >
        <path d="m16 3 11 6.5v13L16 29 5 22.5v-13Zm-11 6.5 11 6.5 11-6.5M16 16v13" />
      </g>
      <path d="M12.5 8h7" stroke="#e8792d" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
