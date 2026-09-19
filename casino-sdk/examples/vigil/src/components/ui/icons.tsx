import type { SVGProps } from 'react';

/** Last Lit — a single amber flame. */
export function FlameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <path
        d="M8 1.83334C8 1.83334 12.1667 4.91668 12.1667 8.66668C12.1667 10.9679 10.3013 12.8333 8 12.8333C5.69882 12.8333 3.83334 10.9679 3.83334 8.66668C3.83334 4.91668 8 1.83334 8 1.83334Z"
        stroke="#FFB648"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 14.1667V12.8333M8 9.5C8 9.5 9.5 10.2 9.5 11.1667C9.5 12.0425 8.82843 12.5 8 12.5C7.17157 12.5 6.5 12.0425 6.5 11.1667C6.5 10.2 8 9.5 8 9.5Z"
        stroke="#FFB648"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Final Three — a row of three candles. */
export function CandlesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <path
        d="M4 9.5V13M8 9.5V13M12 9.5V13"
        stroke="#FFB648"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4 4.5C4 4.5 5 5.2 5 5.9C5 6.5 4.55 6.9 4 6.9C3.45 6.9 3 6.5 3 5.9C3 5.2 4 4.5 4 4.5Z"
        stroke="#FFB648"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.5C8 3.5 9 4.2 9 4.9C9 5.5 8.55 5.9 8 5.9C7.45 5.9 7 5.5 7 4.9C7 4.2 8 3.5 8 3.5Z"
        stroke="#FFB648"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 4.5C12 4.5 13 5.2 13 5.9C13 6.5 12.55 6.9 12 6.9C11.45 6.9 11 6.5 11 5.9C11 5.2 12 4.5 12 4.5Z"
        stroke="#FFB648"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Turbo — Fast Mode row icon (kept from the SDK kit). */
export function RocketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={32}
      height={32}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <path d="M6.03704 23L2.33333 26.8095M9 26.0476L6.77777 28.3333" />
      <path d="M23 11.3333C23 12.622 21.9553 13.6667 20.6667 13.6667C19.378 13.6667 18.3333 12.622 18.3333 11.3333C18.3333 10.0447 19.378 9 20.6667 9C21.9553 9 23 10.0447 23 11.3333Z" />
      <path d="M11.6409 20.3591C9.34232 18.0605 4.33333 16.3731 4.33333 16.3731L7.52111 12.654C8.02772 12.063 8.76732 11.7228 9.54579 11.7228H12.3053C14.9625 6.4082 18.9485 3.08657 28.2491 3.75089C28.9135 13.0515 25.5917 17.0375 20.2772 19.6948V22.4543C20.2772 23.2327 19.9371 23.9723 19.346 24.4789L15.6269 27.6667C15.6269 27.6667 13.9396 22.6577 11.6409 20.3591Z" />
    </svg>
  );
}

/** Green LED strip shown above the active ticket tab. */
export function LedIndicator({ className }: { className?: string }) {
  const pillPath =
    'M 0.464 1.556 ' +
    'C 0.164 1.197 0 0.744 0 0.276 ' +
    'L 0 0 ' +
    'L 20 0 ' +
    'L 20 0.276 ' +
    'C 20 0.744 19.836 1.197 19.536 1.556 ' +
    'L 18.400 2.921 ' +
    'C 17.830 3.605 16.985 4 16.095 4 ' +
    'L 3.905 4 ' +
    'C 3.015 4 2.170 3.605 1.600 2.921 ' +
    'L 0.464 1.556 ' +
    'Z';
  return (
    <svg
      className={className}
      width="20"
      height="6"
      viewBox="0 0 20 6"
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={pillPath} fill="#242424" transform="translate(0 1)" />
      <path d={pillPath} fill="#ffffff" fillOpacity="0.04" transform="translate(0 2)" />
      <path d={pillPath} fill="#59FF38" />
    </svg>
  );
}
