import Link from "next/link";
import { AsciiField } from "./ascii-field";
import { ScrollMelt } from "./scroll-melt";
import { CLOSING, ENTRIES, HERO, HONEST, MELT, PIECES, SITE_CTA, TICKER } from "./site-copy";

/** Primary call to action in the site style. `tone="light"` is for dark sections. */
export function SiteButton({ href, label, tone = "dark" }: { href: string; label: string; tone?: "dark" | "light" }) {
  return (
    <Link href={href} className="site-button" data-tone={tone}>
      {label}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}

function Hero() {
  return (
    <section aria-labelledby="site-hero-title" className="site-hero">
      <div className="site-hero__field">
        <AsciiField className="site-hero__canvas" maxOpacity={0.46} options={{ fadeStart: 0.14, fadeEnd: 0.6 }} />
      </div>
      <div className="site-wrap site-hero__body">
        <p className="site-label">{HERO.label}</p>
        <h1 id="site-hero-title" className="site-h1">
          <span className="site-line">{HERO.headline[0]}</span>
          <span className="site-line">{HERO.headline[1]}</span>
        </h1>
        <p className="site-hero__line">
          <span>{HERO.line}</span>
        </p>
      </div>
    </section>
  );
}

function Ticker() {
  const items = TICKER.map(([label, value]) => (
    <li key={label} className="site-ticker__item">
      <span>{label}</span>
      <span className="site-ticker__sep" aria-hidden="true">
        ·
      </span>
      <span className="site-ticker__value">{value}</span>
      <span className="site-ticker__mark" aria-hidden="true" />
    </li>
  ));
  return (
    <section aria-label="Key dates and limits" className="site-ticker" data-surface="site-dark">
      <div className="site-ticker__track">
        <ul className="site-ticker__list">{items}</ul>
        {/* Second copy makes the loop seamless; assistive tech reads the first copy only. */}
        <ul className="site-ticker__list" aria-hidden="true">
          {items}
        </ul>
      </div>
    </section>
  );
}

function Pieces() {
  return (
    <section aria-labelledby="site-pieces-title" className="site-section">
      <div className="site-wrap">
        <p className="site-label">{PIECES.label}</p>
        <h2 id="site-pieces-title" className="site-h2">
          {PIECES.headline}
        </h2>
        <ol className="site-pieces">
          {PIECES.items.map((item, i) => (
            <li key={item.name} className="site-piece">
              <span className="site-piece__no" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="site-piece__name">{item.name}</h3>
              <p className="site-piece__line">{item.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Honest() {
  return (
    <section aria-labelledby="site-honest-title" className="site-section site-dark" data-surface="site-dark">
      <div className="site-wrap site-honest">
        <div>
          <p className="site-label">{HONEST.label}</p>
          <h2 id="site-honest-title" className="site-h2">
            {HONEST.headline}
          </h2>
        </div>
        <ul className="site-chips">
          {HONEST.chips.map((chip) => (
            <li key={chip} className="site-chip">
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Entries() {
  return (
    <section aria-labelledby="site-entries-title" className="site-section">
      <div className="site-wrap">
        <p className="site-label">{ENTRIES.label}</p>
        <h2 id="site-entries-title" className="site-h2">
          {ENTRIES.headline}
        </h2>
        <ul className="site-tiles">
          {ENTRIES.tiles.map((tile, i) => (
            <li key={tile.href}>
              <Link href={tile.href} className="site-tile">
                <span className="site-tile__no" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="site-tile__title">{tile.title}</span>
                <span className="site-tile__line">{tile.line}</span>
                <span className="site-tile__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="site-closing-title" className="site-section site-dark site-closing" data-surface="site-dark">
      <div className="site-closing__field" aria-hidden="true">
        <AsciiField className="site-hero__canvas" color="#F3F1EC" maxOpacity={0.22} options={{ seed: 7, fadeStart: 0.1, fadeEnd: 0.9 }} />
      </div>
      <div className="site-wrap site-closing__body">
        <h2 id="site-closing-title" className="site-h1">
          <span className="site-line">{CLOSING.headline[0]}</span>
          <span className="site-line">{CLOSING.headline[1]}</span>
        </h2>
        <SiteButton href={SITE_CTA.href} label={SITE_CTA.label} tone="light" />
      </div>
    </section>
  );
}

/** The public home page body. Wrap it in `<PublicShell>`. Every word comes from site-copy.ts. */
export function SiteHome() {
  return (
    <div className="site-page">
      <Hero />
      <Ticker />
      <ScrollMelt label={MELT.label} heading={MELT.headline.map((line) => <span key={line} className="site-line">{line}</span>)} captions={MELT.captions} headingId="site-melt-title" />
      <Pieces />
      <Honest />
      <Entries />
      <Closing />
    </div>
  );
}
