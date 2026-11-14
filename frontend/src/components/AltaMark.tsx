import type { SVGProps } from "react";

export default function AltaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 128 128" role="img" aria-label="Alta Chat" {...props}>
      <defs>
        <linearGradient id="alta-mark-bg" x1="12" y1="8" x2="112" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9A8BFF" />
          <stop offset="1" stopColor="#5844E8" />
        </linearGradient>
        <linearGradient id="alta-mark-line" x1="32" y1="30" x2="91" y2="91" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DDFBFF" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="120" height="120" rx="36" fill="url(#alta-mark-bg)" />
      <path
        d="M64 25.5c-21.3 0-38.5 14.5-38.5 32.4 0 9.1 4.6 17.3 12 23.2l-4.1 17.2c-.5 2.1 1.7 3.9 3.7 2.9l19.1-9.3c2.5.5 5.1.8 7.8.8 21.3 0 38.5-14.5 38.5-32.4S85.3 25.5 64 25.5Z"
        fill="none" stroke="url(#alta-mark-line)" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="48" cy="58" r="4.7" fill="#FFFFFF" />
      <circle cx="64" cy="58" r="4.7" fill="#FFFFFF" />
      <circle cx="80" cy="58" r="4.7" fill="#FFFFFF" />
      <path d="M83 18.5 86.3 11l3.3 7.5 7.5 3.3-7.5 3.3-3.3 7.5-3.3-7.5-7.5-3.3 7.5-3.3Z" fill="#DDFBFF" opacity=".95" />
    </svg>
  );
}
