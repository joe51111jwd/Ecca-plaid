import { cn } from "./cn";

const SIZE = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
} as const;

/** Tints drawn from the palette; chosen by a stable hash of the name so a person keeps their colour. */
const TINTS = ["bg-brand-100 text-brand-800", "bg-accent-100 text-accent-900", "bg-info-100 text-info-800", "bg-success-100 text-success-800", "bg-ink-200 text-ink-800"] as const;

/** Up to two initials: first and last word ("Maria Alvarez" → "MA", "Camp Cedar Creek" → "CC"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function tintOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export interface AvatarProps {
  /** The person's name. Used for the initials and, unless `decorative`, as the accessible name. */
  name: string;
  src?: string | null;
  size?: keyof typeof SIZE;
  /** Set when the name is printed right next to the avatar, so it is not read twice. Default true. */
  decorative?: boolean;
  className?: string;
}

/** A person: photo if there is one, otherwise initials on a stable tint. Round. */
export function Avatar({ name, src, size = "md", decorative = true, className }: AvatarProps) {
  const shared = cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none", SIZE[size], className);
  if (src) {
    // Arbitrary user/partner image hosts are not configured for next/image optimisation.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={decorative ? "" : name} className={cn(shared, "object-cover")} />;
  }
  return (
    <span role={decorative ? undefined : "img"} aria-label={decorative ? undefined : name} aria-hidden={decorative ? true : undefined} className={cn(shared, tintOf(name))}>
      {initialsOf(name)}
    </span>
  );
}

export interface OrgMarkProps {
  /** The organization's name: a scholarship organization, camp or school. */
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZE;
  decorative?: boolean;
  className?: string;
}

/** An organization: its logo if it has one, otherwise initials. Square with rounded corners, to tell it from a person. */
export function OrgMark({ name, logoUrl, size = "md", decorative = true, className }: OrgMarkProps) {
  const shared = cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line font-semibold select-none", SIZE[size], className);
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- partner logos come from arbitrary hosts
    return <img src={logoUrl} alt={decorative ? "" : name} className={cn(shared, "bg-surface object-contain p-0.5")} />;
  }
  return (
    <span role={decorative ? undefined : "img"} aria-label={decorative ? undefined : name} aria-hidden={decorative ? true : undefined} className={cn(shared, "border-transparent", tintOf(name))}>
      {initialsOf(name)}
    </span>
  );
}
