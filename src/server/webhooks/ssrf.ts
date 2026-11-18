import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { isProd } from "@/lib/env";
import { invalid } from "@/lib/errors";

/**
 * Server-side request forgery guard for customer-supplied webhook URLs.
 *
 * A webhook URL makes our servers send a request wherever the customer points, so it must never reach
 * our own network: loopback, private ranges, link-local (which includes the cloud metadata service),
 * carrier-grade NAT, or any other non-public address. The check runs when an endpoint is saved and again
 * for every delivery, on the addresses the host name resolves to at that moment; delivery then connects
 * to exactly those addresses (see ./deliver), so a DNS answer cannot change between check and use.
 */

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolves a host name to all of its addresses. Must reject when there is no answer. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type AddressClass = "public" | "loopback" | "private" | "link_local" | "cgnat" | "metadata" | "multicast" | "unspecified" | "reserved";

/** Longest URL we store. */
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** A DNS lookup that takes longer than this counts as "no answer right now". */
export const DNS_TIMEOUT_MS = 5000;

/** Hosts that may point at this machine outside production, so local receivers and tests work. */
const DEV_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function list(entries: Array<[prefix: string, bits: number, family: "ipv4" | "ipv6"]>): BlockList {
  const blockList = new BlockList();
  for (const [prefix, bits, family] of entries) blockList.addSubnet(prefix, bits, family);
  return blockList;
}

/**
 * Non-public ranges from the IANA special-purpose address registries (RFC 6890 and updates), most
 * specific class first. Cloud metadata services get their own label because they are the classic SSRF
 * target: 169.254.169.254 (AWS, GCP, Azure, others), fd00:ec2::254 (AWS over IPv6),
 * 100.100.100.200 (Alibaba Cloud) and 168.63.129.16 (Azure platform address, which sits in public space).
 */
const CLASSES: Array<[AddressClass, BlockList]> = [
  [
    "metadata",
    list([
      ["169.254.169.254", 32, "ipv4"],
      ["100.100.100.200", 32, "ipv4"],
      ["168.63.129.16", 32, "ipv4"],
      ["fd00:ec2::254", 128, "ipv6"],
    ]),
  ],
  [
    "loopback",
    list([
      ["127.0.0.0", 8, "ipv4"],
      ["::1", 128, "ipv6"],
    ]),
  ],
  [
    "unspecified",
    list([
      ["0.0.0.0", 8, "ipv4"],
      ["::", 128, "ipv6"],
    ]),
  ],
  [
    "private",
    list([
      ["10.0.0.0", 8, "ipv4"],
      ["172.16.0.0", 12, "ipv4"],
      ["192.168.0.0", 16, "ipv4"],
      ["fc00::", 7, "ipv6"], // unique local
      ["fec0::", 10, "ipv6"], // site-local (deprecated)
    ]),
  ],
  [
    "link_local",
    list([
      ["169.254.0.0", 16, "ipv4"],
      ["fe80::", 10, "ipv6"],
    ]),
  ],
  ["cgnat", list([["100.64.0.0", 10, "ipv4"]])],
  [
    "multicast",
    list([
      ["224.0.0.0", 4, "ipv4"],
      ["ff00::", 8, "ipv6"],
    ]),
  ],
  [
    "reserved",
    list([
      ["192.0.0.0", 24, "ipv4"], // IETF protocol assignments
      ["192.0.2.0", 24, "ipv4"], // documentation
      ["192.88.99.0", 24, "ipv4"], // 6to4 relay anycast (deprecated)
      ["198.18.0.0", 15, "ipv4"], // benchmarking
      ["198.51.100.0", 24, "ipv4"], // documentation
      ["203.0.113.0", 24, "ipv4"], // documentation
      ["240.0.0.0", 4, "ipv4"], // reserved, includes broadcast
      ["2001::", 23, "ipv6"], // IETF protocol assignments, includes Teredo
      ["2001:db8::", 32, "ipv6"], // documentation
      ["2002::", 16, "ipv6"], // 6to4: embeds an IPv4 address
      ["3fff::", 20, "ipv6"], // documentation
    ]),
  ],
];

/** Global unicast space. IPv6 addresses outside it (NAT64, discard-only, unassigned...) are never public. */
const IPV6_GLOBAL_UNICAST = list([["2000::", 3, "ipv6"]]);

const IPV4_MAPPED = list([["::ffff:0:0", 96, "ipv6"]]);

/** Rewrites an IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) as plain IPv4. */
function unmapIpv4(address: string): string | null {
  if (!IPV4_MAPPED.check(address, "ipv6")) return null;
  const tail = address.slice(address.lastIndexOf(":") + 1);
  if (isIP(tail) === 4) return tail;
  const groups = address.split(":").filter((g) => g.length > 0);
  const high = Number.parseInt(groups.at(-2) ?? "", 16);
  const low = Number.parseInt(groups.at(-1) ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** Classifies an IP address literal. Anything that is not an IP address is "reserved" (never connectable). */
export function classifyAddress(address: string): AddressClass {
  let ip = address;
  let family = isIP(ip);
  if (family === 6) {
    const mapped = unmapIpv4(ip);
    if (mapped) {
      ip = mapped;
      family = 4;
    }
  }
  if (family === 0) return "reserved";
  const kind = family === 4 ? "ipv4" : "ipv6";
  for (const [label, blockList] of CLASSES) if (blockList.check(ip, kind)) return label;
  if (family === 6 && !IPV6_GLOBAL_UNICAST.check(ip, "ipv6")) return "reserved";
  return "public";
}

const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

let testResolver: Resolver | null = null;

/** Test-only: replaces DNS for webhook URL checks (pass null to restore the system resolver). */
export function setWebhookResolverForTests(resolver: Resolver | null): void {
  if (isProd()) throw new Error("setWebhookResolverForTests is not allowed in production");
  testResolver = resolver;
}

export interface SafeWebhookUrl {
  /** Normalized URL (fragment removed). */
  url: string;
  hostname: string;
  /**
   * The vetted addresses to connect to. Empty only when the check ran for registration and DNS gave no
   * usable answer; delivery never proceeds without addresses.
   */
  addresses: ResolvedAddress[];
}

export interface WebhookUrlCheckOptions {
  /**
   * "register" (default): saving an endpoint. A host whose DNS is temporarily unavailable is accepted,
   * because delivery checks again. "deliver": about to send; any resolution failure is an error.
   */
  phase?: "register" | "deliver";
  /** Defaults to `isProd()`. In production only https is accepted and loopback is never allowed. */
  production?: boolean;
  resolve?: Resolver;
}

const CLASS_TEXT: Record<Exclude<AddressClass, "public">, string> = {
  loopback: "a loopback address",
  private: "a private network address",
  link_local: "a link-local address",
  cgnat: "a carrier-grade NAT address",
  metadata: "a cloud metadata service address",
  multicast: "a multicast address",
  unspecified: "an unspecified address",
  reserved: "a reserved address",
};

function refuse(message: string): never {
  throw invalid(message, { fields: { url: message } });
}

function withDnsTimeout<T>(lookupResult: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), DNS_TIMEOUT_MS);
  });
  return Promise.race([lookupResult, timeout]).finally(() => clearTimeout(timer));
}

/** DNS said the name does not exist, as opposed to "could not ask right now". */
function isDefinitiveDnsFailure(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

/**
 * Validates a webhook URL and resolves its host. Throws a `validation_failed` AppError (with
 * `details.fields.url`) when the URL is malformed, uses a scheme other than http(s), is plain http in
 * production, embeds credentials, or points at a non-public address, either literally or through DNS.
 * Outside production, `localhost`, `127.0.0.1` and `[::1]` are allowed.
 */
export async function assertSafeWebhookUrl(rawUrl: string, opts: WebhookUrlCheckOptions = {}): Promise<SafeWebhookUrl> {
  const production = opts.production ?? isProd();
  const phase = opts.phase ?? "register";
  if (typeof rawUrl !== "string" || rawUrl.length === 0) refuse("Enter the webhook URL");
  if (rawUrl.length > MAX_WEBHOOK_URL_LENGTH) refuse(`The webhook URL must be at most ${MAX_WEBHOOK_URL_LENGTH} characters`);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    refuse("The webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") refuse("The webhook URL must start with https://");
  if (production && url.protocol !== "https:") refuse("The webhook URL must use https");
  if (url.username !== "" || url.password !== "") refuse("The webhook URL must not contain a username or password");
  url.hash = "";

  // WHATWG URL parsing has already canonicalized the host: IPv4 in any notation (decimal, hex, short)
  // is dotted-quad here and IPv6 is bracketed, so the literal check below cannot be dodged by spelling.
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (hostname === "") refuse("The webhook URL must include a host");
  const loopbackAllowed = !production && DEV_LOOPBACK_HOSTS.has(hostname);

  const vet = (address: string): void => {
    const kind = classifyAddress(address);
    if (kind === "public" || (kind === "loopback" && loopbackAllowed)) return;
    refuse(`The webhook URL points to ${CLASS_TEXT[kind]}, which is not allowed`);
  };

  const family = isIP(hostname);
  if (family !== 0) {
    vet(hostname);
    return { url: url.toString(), hostname, addresses: [{ address: hostname, family: family === 6 ? 6 : 4 }] };
  }

  const resolve = opts.resolve ?? testResolver ?? systemResolver;
  let addresses: ResolvedAddress[];
  try {
    addresses = await withDnsTimeout(resolve(hostname));
  } catch (e) {
    if (phase === "register" && !isDefinitiveDnsFailure(e)) return { url: url.toString(), hostname, addresses: [] };
    refuse("The webhook URL host could not be resolved");
  }
  if (addresses.length === 0) refuse("The webhook URL host could not be resolved");
  // Every answer must be acceptable: one private record among public ones is enough to be steered inside.
  for (const a of addresses) vet(a.address);
  return { url: url.toString(), hostname, addresses };
}
