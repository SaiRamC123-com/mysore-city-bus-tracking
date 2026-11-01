/**
 * App logo: a bus inside a location pin (amber on navy). Same drawing as public/favicon.svg.
 * <LogoMark/> is the icon alone; <Logo/> adds the name beside it.
 */
export function LogoMark({ size = 40, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Mysuru Bus">
      <rect width="64" height="64" rx="16" fill="#0b2a5b" />
      <path d="M32 5C19.8 5 11 14.2 11 25.6 11 40.5 32 60 32 60s21-19.5 21-34.4C53 14.2 44.2 5 32 5Z" fill="#ffb400" />
      <circle cx="32" cy="25.5" r="15.5" fill="#0b2a5b" />
      <rect x="21" y="15.5" width="22" height="19" rx="4.5" fill="#ffffff" />
      <rect x="24" y="18.5" width="16" height="8" rx="2" fill="#0b2a5b" />
      <circle cx="26.5" cy="30.5" r="1.9" fill="#0b2a5b" />
      <circle cx="37.5" cy="30.5" r="1.9" fill="#0b2a5b" />
      <rect x="23" y="34" width="4" height="3" rx="1" fill="#ffffff" />
      <rect x="37" y="34" width="4" height="3" rx="1" fill="#ffffff" />
    </svg>
  );
}

export default function Logo({ name }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={38} />
      <span className="hidden font-display text-xl font-extrabold leading-none tracking-tight min-[400px]:block">
        {name}
      </span>
    </span>
  );
}