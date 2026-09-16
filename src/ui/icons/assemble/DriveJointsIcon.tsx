import type { SVGProps } from 'react'

export function DriveJointsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} {...props}>
      <polygon
        points="2.5,21.15 16,28.94 16,25.2 2.5,17.4"
        fill="#a9b2bb"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="29.5,21.15 16,28.94 16,25.2 29.5,17.4"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        points="16,9.61 29.5,17.4 16,25.2 2.5,17.4"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M12.75 4.93L12.75 17.4A3.25 1.87 0 0 0 19.25 17.4L19.25 4.93Z"
        fill="#8a949e"
        stroke="#3c4652"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="4.93"
        rx="3.25"
        ry="1.87"
        fill="#c9d0d7"
        stroke="#3c4652"
        strokeWidth={1.2}
      />
      <path
        d="M23.14 12.96A8.02 4.63 0 1 1 14.23 6.34"
        fill="none"
        stroke="#e8792d"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <polygon
        points="17.25,6.28 13.28,8.02 13.66,3.86"
        fill="#e8792d"
        stroke="#e8792d"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
