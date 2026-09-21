// Meta title builder — one fixed shape for every page Boko writes:
//
//     Page title | Keyword | Site name
//
// "|" is the only separator. Page title and keyword are written in sentence
// case (first letter capitalised, the rest lower), because Title Case Reads
// Like Spam in search results. The exceptions are words that genuinely carry
// capitals: acronyms (SEO, AI, AUD), brand-style words (iPhone, WooCommerce),
// and proper nouns the page itself capitalises (Sydney, Venom Emilio). The
// site name is a proper noun and is used exactly as the site spells it.
//
// Used by /api/generate in both the Shopify and WordPress studios, for the AI
// output and the rule-based fallback alike, so the shape is identical
// whichever produced it.

export const SEP = " | ";
export const TITLE_MAX = 60;

// Joining words that stay lowercase in Title Case, so they don't stop us
// recognising a Title-Cased string ("Terms and Conditions").
const SMALL = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
  "of", "on", "or", "per", "the", "to", "vs", "via", "with", "&",
]);

// Words that never make a useful keyword on their own.
const STOP = new Set([
  ...SMALL, "is", "are", "was", "be", "been", "it", "its", "this", "that", "these",
  "those", "our", "your", "we", "you", "they", "their", "us", "my", "i", "can",
  "will", "all", "any", "more", "most", "new", "get", "has", "have", "not", "no",
  "so", "up", "out", "about", "than", "then", "there", "here", "what", "when",
  "how", "why", "who", "which", "also", "just", "only", "very", "one", "each",
  "every", "other", "some", "such", "own", "same", "home", "page", "click", "read",
  "learn", "shop", "buy", "online", "view", "see", "now", "today", "month", "months",
  "year", "years", "day", "days", "working",
]);

function clean(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip separators and dashes left dangling at either end. */
function tidy(s) {
  return clean(s).replace(/^[\s|\-–—:,;.]+|[\s|\-–—:,;]+$/g, "").trim();
}

const core = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const isAcronym = (w) => {
  const c = core(w);
  return c.length >= 2 && c.length <= 6 && /^[\p{Lu}\p{N}&]+$/u.test(c) && /\p{Lu}/u.test(c);
};
// iPhone, WooCommerce, eBay, McDonald — capitals that aren't just an initial.
const isMixed = (w) => /\p{Ll}\p{Lu}/u.test(core(w));
const startsUpper = (w) => /^\p{Lu}/u.test(core(w));

/**
 * Proper nouns the source text itself vouches for: capitalised somewhere
 * other than the start of a sentence, and never written in lowercase. That
 * keeps "Sydney" and "Venom Emilio" while dropping heading-style capitals like
 * "Design", which also appear as "design" in the body copy.
 */
export function properNouns(...texts) {
  const capital = new Map();
  const lower = new Set();
  for (const text of texts) {
    for (const sentence of clean(text).split(/(?<=[.!?])\s+/)) {
      const words = sentence.split(" ");
      words.forEach((w, i) => {
        const c = core(w);
        if (!c || !/\p{L}/u.test(c)) return;
        const key = c.toLowerCase();
        if (startsUpper(c) && !isAcronym(c)) {
          if (i > 0) capital.set(key, c);
        } else if (/^\p{Ll}/u.test(c)) {
          lower.add(key);
        }
      });
    }
  }
  const out = new Map();
  for (const [k, v] of capital) if (!lower.has(k) && !SMALL.has(k)) out.set(k, v);
  return out;
}

/**
 * Sentence case, without flattening words that should keep their capitals.
 * A string that is plainly Title Case has every ordinary word lowercased;
 * anything else keeps its casing and just gets a capital first letter.
 */
export function sentenceCase(s, proper = new Map()) {
  const words = tidy(s).split(" ").filter(Boolean);
  if (!words.length) return "";

  const content = words.filter((w) => /\p{L}/u.test(w) && !SMALL.has(core(w).toLowerCase()));
  const titleCased =
    content.length >= 2 && content.every((w) => startsUpper(w) || isAcronym(w) || isMixed(w));
  const allCaps = content.length >= 2 && content.every((w) => isAcronym(w) || !/\p{Ll}/u.test(w));

  const out = words.map((w) => {
    const c = core(w);
    const key = c.toLowerCase();
    if (proper.has(key)) return w.replace(c, proper.get(key));
    if (!allCaps && (isAcronym(w) || isMixed(w))) return w;
    if (titleCased || allCaps || SMALL.has(key)) return w.toLowerCase();
    return w;
  });

  // Capital first letter — unless the word is deliberately lower-first (iPhone, eBay).
  const first = out[0];
  const i = first.search(/\p{L}/u);
  if (i >= 0 && !isMixed(first)) {
    out[0] = first.slice(0, i) + first.charAt(i).toUpperCase() + first.slice(i + 1);
  }
  return out.join(" ");
}

function lowerWords(s) {
  return clean(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when every word of `needle` already appears in `hay`. */
function covered(needle, hay) {
  const h = new Set(lowerWords(hay));
  const n = lowerWords(needle);
  return n.length > 0 && n.every((w) => h.has(w));
}

/**
 * Assemble "Page title | Keyword | Site name" within `max` characters.
 *
 * When it won't fit, it gives ground in this order: the site name, then a
 * long page title (never below ~24 characters), then the keyword. A keyword
 * the page title already says is dropped rather than repeated, and a site
 * name inside the page title is moved to the end.
 */
export function buildMetaTitle({ page, keyword, site, context = "", max = TITLE_MAX }) {
  const siteName = tidy(site);
  const proper = properNouns(context, siteName);
  for (const w of siteName.split(" ")) {
    const c = core(w);
    if (c && startsUpper(c)) proper.set(c.toLowerCase(), c);
  }

  // Page titles often arrive as "Brand – Home" or "Home | Brand". The site
  // name belongs in the last slot, so lift it out of the page part.
  let rawPage = clean(page);
  if (siteName) {
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = tidy(
      rawPage.replace(new RegExp(`\\s*[|\\-–—:]*\\s*${esc}\\s*[|\\-–—:]*\\s*`, "i"), " ")
    );
    if (stripped) rawPage = stripped;
  }
  // Any separator left inside the page part would read as a fourth segment.
  rawPage = rawPage.replace(/\s+[|–—]\s+|\s+-\s+/g, " ");

  let p = sentenceCase(rawPage, proper);
  let k = sentenceCase(keyword, proper);
  let s = siteName;

  if (s && p && covered(s, p)) s = "";
  if (k && (covered(k, p) || (s && covered(k, s)))) k = "";

  const join = () => [p, k, s].filter(Boolean).join(SEP);
  const fits = () => join().length <= max;

  const trimPage = (to) => {
    if (p.length <= to) return;
    let t = p.slice(0, to);
    const sp = t.lastIndexOf(" ");
    if (sp > to * 0.5) t = t.slice(0, sp);
    t = t.split(" ");
    while (t.length > 1 && STOP.has(core(t[t.length - 1]).toLowerCase())) t.pop();
    p = tidy(t.join(" "));
  };

  // A keyword is kept whole or not at all — "Shopify product" cut down from
  // "Shopify product recommendations" is no longer the phrase anyone searches.
  // So when it's too long, give ground in order of least value: the site name
  // first, then a long page title, and only then the keyword.
  if (!fits() && s) s = "";
  if (!fits() && k) trimPage(Math.max(24, max - SEP.length - k.length));
  if (!fits() && k) k = "";
  if (!fits()) trimPage(max);
  return join();
}

/**
 * Rule-based keyword, for when AI isn't available: the phrase the page's own
 * copy repeats most, that the page title doesn't already say. Two to three
 * words, no numbers, not starting or ending on a filler word. Returns "" when
 * the copy doesn't repeat anything worth using — better no keyword than a
 * made-up one.
 */
export function guessKeyword({ title, context }) {
  const words = clean(context).split(/[^\p{L}\p{N}'&]+/u).filter(Boolean);
  const counts = new Map();
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      const low = gram.map((w) => w.toLowerCase());
      if (low.some((w) => /\d/.test(w) || w.length < 2)) continue;
      if (STOP.has(low[0]) || STOP.has(low[n - 1])) continue;
      if (low.filter((w) => !STOP.has(w)).length < 2) continue;
      const key = low.join(" ");
      const hit = counts.get(key) || { n: 0, text: gram.join(" "), len: n };
      hit.n += 1;
      counts.set(key, hit);
    }
  }
  let best = null;
  for (const [key, v] of counts) {
    if (v.n < 2) continue;
    if (covered(key, title)) continue;
    if (!best || v.n > best.n || (v.n === best.n && v.len > best.len)) best = v;
  }
  return best ? best.text : "";
}
