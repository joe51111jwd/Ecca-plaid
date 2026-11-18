import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import { escapeHtml, extractLinks, htmlToText, renderEmail } from "./render";

const XSS = `<script>alert("x")</script><img src=x onerror='alert(1)'> & "quotes"`;

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;");
  });

  it("escapes ampersands first, so existing entities are not double-decoded later", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("stringifies other values and treats null/undefined as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(1700)).toBe("1700");
    expect(escapeHtml(false)).toBe("false");
  });
});

describe("renderEmail", () => {
  const full = () =>
    renderEmail({
      preheader: "Your sign-in link",
      heading: "Sign in",
      paragraphs: ["First paragraph.", "Second paragraph\nwith a line break.", "   "],
      details: [
        { label: "Amount", value: "$500" },
        { label: "Organization", value: "Synthetic Scholarship Fund" },
      ],
      cta: { label: "Sign in now", url: "https://app.example.org/auth/callback?token=abc123&next=%2Ffamily" },
      code: { label: "Or enter this code", value: "482913" },
      footerNote: "If you did not ask for this, ignore this email.",
    });

  it("produces a complete, self-contained HTML document", () => {
    const { html } = full();
    expect(html.startsWith("<!DOCTYPE html>\n<html lang=\"en\" dir=\"ltr\">")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("<title>Sign in</title>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    // Inline styles only: nothing is fetched, nothing can run.
    expect(html).not.toMatch(/<(script|style|link|img|iframe|object|embed|form|svg)\b/i);
    expect(html).not.toMatch(/\b(src|srcset|background)\s*=/i);
    expect(html).not.toMatch(/url\(|@import|javascript:|\bon[a-z]+\s*=/i);
  });

  it("is accessible and mobile friendly", () => {
    const { html } = full();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const tables = html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toContain('role="presentation"');
    expect(html).toContain("max-width:560px");
    expect(html).toContain('width="100%"');
    expect(html).toContain('<th scope="row"');
    // Body text is at least 16px.
    expect(html).toMatch(/<p style="[^"]*font-size:16px/);
  });

  it("uses the brand name from src/lib/brand", () => {
    const { html, text } = full();
    expect(html).toContain(`>${BRAND.name}</td>`);
    expect(html).toContain(`Sent by ${BRAND.name}`);
    expect(text.trimEnd().endsWith(`Sent by ${BRAND.name}`)).toBe(true);
  });

  it("renders the call to action as a button plus the bare link", () => {
    const { html } = full();
    const href = "https://app.example.org/auth/callback?token=abc123&amp;next=%2Ffamily";
    expect(html.split(`href="${href}"`).length - 1).toBe(2);
    expect(html).toContain(">Sign in now</a>");
    expect(html).toContain(`>${href}</a>`);
    expect(html).toContain("If the button does not work, copy and paste this link into your browser:");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("hides the preheader and omits it when not given", () => {
    expect(full().html).toMatch(/<div style="display:none;[^"]*">Your sign-in link<\/div>/);
    expect(renderEmail({ heading: "Hi", paragraphs: ["x"] }).html).not.toContain("display:none");
  });

  it("writes a faithful plain-text alternative", () => {
    const { text } = full();
    expect(text).toBe(
      [
        "Sign in",
        "First paragraph.",
        "Second paragraph\nwith a line break.",
        "Amount: $500\nOrganization: Synthetic Scholarship Fund",
        "Sign in now:\nhttps://app.example.org/auth/callback?token=abc123&next=%2Ffamily",
        "Or enter this code: 482913",
        "If you did not ask for this, ignore this email.",
        `Sent by ${BRAND.name}`,
      ].join("\n\n") + "\n",
    );
    expect(text).not.toMatch(/<[a-z!/]/i);
    expect(text).not.toContain("&amp;");
  });

  it("escapes user input in every slot of the HTML and leaves it verbatim in the text", () => {
    const { html, text } = renderEmail({
      preheader: XSS,
      heading: XSS,
      paragraphs: [XSS],
      details: [{ label: XSS, value: XSS }],
      cta: { label: XSS, url: "https://example.org/x" },
      code: { label: XSS, value: XSS },
      footerNote: XSS,
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/onerror\s*=\s*'/);
    const escaped = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt; &amp; &quot;quotes&quot;";
    // preheader, title, h1, paragraph, detail label, detail value, button label, code label, code value, footer
    expect(html.split(escaped).length - 1).toBe(10);
    // heading, paragraph, detail label, detail value, button label, code label, code value, footer
    expect(text.split(XSS).length - 1).toBe(8);
  });

  it("cannot be broken out of through the link", () => {
    const { html, text } = renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: "Go", url: `https://example.org/?q="><script>alert(1)</script>&x='y'` } });
    expect(html).not.toContain("<script");
    expect(html).not.toContain(`q="`);
    expect(html).not.toContain("x='");
    expect(html).toContain('href="https://example.org/?q=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&amp;x=%27y%27"');
    expect(text).toContain("https://example.org/?q=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&x=%27y%27");
  });

  it("only links to absolute http(s) URLs", () => {
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>", "/relative/path", "//example.org/x", "mailto:someone@example.org", "ftp://example.org/x", "", "not a url", "vbscript:x"]) {
      expect(() => renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: "Go", url } }), url).toThrow(/http\(s\) URL/);
    }
    expect(() => renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: "Go", url: "http://localhost:3000/dev" } })).not.toThrow();
  });

  it("requires a heading and a button label", () => {
    expect(() => renderEmail({ heading: "  ", paragraphs: ["x"] })).toThrow(/heading/);
    expect(() => renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: " ", url: "https://example.org" } })).toThrow(/label/);
  });

  it("keeps line breaks inside a paragraph and drops empty paragraphs", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["line one\nline two", "", "  \n "] });
    expect(html).toContain("line one<br>line two");
    expect(html.match(/<p /g)).toHaveLength(1);
  });

  it("speaks Spanish when asked", () => {
    const { html, text } = renderEmail({ heading: "Inicie sesión", paragraphs: ["Use el botón para entrar."], cta: { label: "Entrar", url: "https://example.org/es" }, locale: "es" });
    expect(html).toContain('<html lang="es"');
    expect(html).toContain("Si el botón no funciona, copie y pegue este enlace en su navegador:");
    expect(html).toContain(`Enviado por ${BRAND.name}`);
    expect(text).toContain(`Enviado por ${BRAND.name}`);
    expect(text).not.toContain("Sent by");
    expect(renderEmail({ heading: "Hi", paragraphs: ["x"], locale: "fr" as never }).html).toContain('<html lang="en"');
  });

  it("inserts trusted bodyHtml as-is and derives the text from it", () => {
    const bodyHtml = `<p>Thank you, ${escapeHtml("Ana <ana@example.org>")}.</p><ul><li>Gift: $1,700</li><li>See <a href="https://example.org/receipt?id=1&amp;v=2">your receipt</a></li></ul>`;
    const { html, text } = renderEmail({ heading: "Receipt", bodyHtml });
    expect(html).toContain(bodyHtml);
    expect(text).toBe(["Receipt", "Thank you, Ana <ana@example.org>.", "- Gift: $1,700\n- See your receipt (https://example.org/receipt?id=1&v=2)", `Sent by ${BRAND.name}`].join("\n\n") + "\n");
  });

  it("works with the minimum input", () => {
    const { html, text } = renderEmail({ heading: "Hello", paragraphs: [] });
    expect(html).toContain("<h1");
    expect(text).toBe(`Hello\n\nSent by ${BRAND.name}\n`);
  });
});

describe("htmlToText", () => {
  it("turns blocks into paragraphs and keeps link targets", () => {
    expect(htmlToText("<h2>Title</h2><p>One<br>two</p><div>Three</div>")).toBe("Title\n\nOne\ntwo\n\nThree");
    expect(htmlToText('<a href="https://example.org">https://example.org</a>')).toBe("https://example.org");
    expect(htmlToText("<a href='https://example.org/a'><b>Open</b></a>")).toBe("Open (https://example.org/a)");
  });

  it("drops scripts, styles and comments entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><script>alert(1)</script><!-- note --><p>Visible</p>")).toBe("Visible");
  });

  it("decodes entities exactly once", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot; &#39;now&#39; &#x26; &nbsp;later &unknown;</p>")).toBe(`Tom & Jerry <3 "cheese" 'now' & later &unknown;`);
    expect(htmlToText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("renders table rows on their own lines", () => {
    expect(htmlToText("<table><tr><td>Amount</td><td>$500</td></tr><tr><td>Date</td><td>Jan 2</td></tr></table>")).toBe("Amount $500\nDate Jan 2");
  });
});

describe("extractLinks", () => {
  it("finds http(s) links in order, without trailing punctuation or duplicates", () => {
    const text = "Sign in: https://app.example.org/a?token=abc&x=1.\nDocs (https://example.org/docs). Again https://app.example.org/a?token=abc&x=1, and http://localhost:3000/v/tok_1!";
    expect(extractLinks(text)).toEqual(["https://app.example.org/a?token=abc&x=1", "https://example.org/docs", "http://localhost:3000/v/tok_1"]);
  });

  it("keeps brackets that belong to the URL", () => {
    expect(extractLinks("See https://example.org/wiki/Credit_(tax) for more")).toEqual(["https://example.org/wiki/Credit_(tax)"]);
  });

  it("ignores other schemes and plain text", () => {
    expect(extractLinks("mailto:a@example.org ftp://example.org javascript:alert(1) example.org")).toEqual([]);
    expect(extractLinks("")).toEqual([]);
  });

  it("finds the link in a rendered email", () => {
    const { text } = renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: "Go", url: "https://example.org/go?t=1" } });
    expect(extractLinks(text)).toEqual(["https://example.org/go?t=1"]);
  });
});
