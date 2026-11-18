const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** True for absolute URLs and scheme links (https:, mailto:, tel:), which must not go through next/link. */
export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF.test(href);
}
