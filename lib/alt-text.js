// Rule-based image alt-text generator (free, instant, no API key).
//
// Used by both the Shopify and WordPress Boko SEO apps. Given whatever signals
// we can get about an image — the product/post it belongs to, its filename and
// its position in the gallery — it writes a short, human, accessible alt
// string. No "image of", no keyword stuffing, hard-capped at ALT_MAX.
//
// It deliberately never invents detail it can't see. If there's nothing usable
// to work from it returns an empty string and flags `needsManual`, so the UI
// can ask a human rather than saving something useless.


import { ALT_MAX, auditAlt } from "@/lib/seo-audit";

// Re-exported so callers can keep importing these from here; seo-audit.js is
// the single source of truth for what counts as good alt text.
export { ALT_MAX, auditAlt };

// Positional descriptors for the 2nd, 3rd, ... image of the same item.
// Index 0 gets no suffix — the first image is "the" image of the product.
const VIEW_LABELS = [
  "",
  "alternate view",
  "side view",
  "back view",
  "close-up detail",
  "styled view",
  "detail view",
  "worn view",
  "flat lay view",
];

// Filename tokens that carry no meaning for a reader.
const JUNK_TOKENS = new Set([
  "img", "image", "images", "imgp", "dsc", "dscn", "dscf", "pxl", "gopr",
  "photo", "photos", "pic", "pics", "picture", "pictures", "screenshot",
  "screen", "shot", "untitled", "unnamed", "download", "downloads", "file",
  "files", "copy", "final", "finalfinal", "new", "old", "temp", "tmp",
  "export", "exported", "asset", "assets", "media", "upload", "uploaded",
  "uploads", "shopify", "wordpress", "woocommerce", "preview", "thumb",
  "thumbnail", "cropped", "resized", "rescaled", "scaled", "edited", "edit",
  "version", "ver", "draft", "test", "sample", "default", "placeholder",
  "photoroom", "canva", "png", "jpg", "jpeg", "webp", "avif", "gif",
  "transparent", "background", "bg", "web", "webready", "small", "medium",
  "large", "grande", "compact", "master", "original", "hires", "highres",
  "lowres", "retina", "mobile", "desktop", "square", "portrait", "landscape",
]);

// Words we never want to open alt text with.
const LEADING_NOISE = /^(an?\s+)?(image|photo|photograph|picture|pic|screenshot|graphic|illustration|shot)\s+(of|showing|depicting)\s+/i;

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

function squash(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** Strip HTML and collapse whitespace. */
export function cleanText(s) {
  return squash(String(s || "").replace(/<[^>]*>/g, " "));
}

/** Trim to `max` chars on a word boundary, without trailing punctuation. */
export function trimTo(s, max = ALT_MAX) {
  const v = squash(s);
  if (v.length <= max) return v;
  let t = v.slice(0, max);
  const i = t.lastIndexOf(" ");
  if (i > max * 0.5) t = t.slice(0, i);
  return t.replace(/[\s,;:.\-–—|/&]+$/, "").trim();
}

/**
 * Pull the readable part out of an image filename or URL.
 * "black-linen-shirt-back_1024x1024@2x.jpg?v=1699" -> "black linen shirt back"
 * "IMG_4821.JPG" -> ""
 */
export function readableFilename(input) {
  if (!input) return "";
  let s = decode(String(input));

  // URL -> last path segment, no query/hash.
  s = s.split(/[?#]/)[0];
  s = s.split("/").pop() || "";

  // Drop the extension.
  s = s.replace(/\.[a-z0-9]{2,5}$/i, "");

  // Shopify / WordPress size + variant suffixes. These stack
  // ("shirt_1024x1024@2x"), so strip repeatedly until nothing more comes off.
  const SUFFIXES = [
    /[-_ ]?\d{2,5}x\d{0,5}(_crop_[a-z]+)?$/i,
    /[-_ ]?@\dx$/i,
    /[-_ ](scaled|rotated|edited|e\d{6,})$/i,
    /[-_ ](pico|icon|thumb|small|compact|medium|large|grande|master|original|\d{3,4}w)$/i,
    /[-_ ]copy(\s*\d+)?$/i,
  ];
  for (let pass = 0; pass < 6; pass++) {
    const before = s;
    for (const re of SUFFIXES) s = s.replace(re, "");
    if (s === before) break;
  }

  // Separators -> spaces.
  s = s.replace(/[-_+.,~]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");

  const tokens = squash(s)
    .split(" ")
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .filter((t) => {
      const low = t.toLowerCase();
      if (JUNK_TOKENS.has(low)) return false;
      if (/^\d+$/.test(t)) return false; // pure numbers: 4821, 20240113
      if (/^\d+x\d*$/i.test(t)) return false; // leftover dimensions: 1024x1024
      if (/^[0-9a-f]{8,}$/i.test(t)) return false; // hashes / uuid chunks
      if (/^v\d+$/i.test(t)) return false; // v2, v10
      if (t.length < 2) return false;
      return true;
    });

  const out = squash(tokens.join(" ")).toLowerCase();

  // Needs to actually read like words, not a code.
  const words = out.split(" ").filter((w) => /\p{L}/u.test(w));
  const letters = out.replace(/[^\p{L}]/gu, "").length;
  if (words.length < 2 || letters < 6) return "";
  return out;
}

function tokenSet(s) {
  return new Set(
    squash(String(s || "").toLowerCase())
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
  );
}

function sentenceCase(s) {
  const v = squash(s);
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function viewLabel(index) {
  if (!index || index < 1) return "";
  return VIEW_LABELS[index] || `view ${index + 1}`;
}

/**
 * Write alt text for one image.
 *
 * @param {object} input
 * @param {string} input.ownerTitle  Product / post / collection title the image belongs to.
 * @param {string} input.filename    Filename or full image URL.
 * @param {number} input.index       0-based position among that owner's images.
 * @param {string} input.kind        "product" | "collection" | "article" | "page" | "post" | "media"
 * @param {string} [input.caption]   Existing caption / attachment title, if any.
 * @returns {{alt: string, source: string, needsManual: boolean}}
 */
export function suggestAlt(input = {}) {
  const ownerTitle = cleanText(input.ownerTitle).replace(LEADING_NOISE, "");
  const caption = cleanText(input.caption).replace(LEADING_NOISE, "");
  const fileWords = readableFilename(input.filename);
  const index = Number(input.index) || 0;
  const kind = input.kind || "media";

  // A caption written by a human beats anything we can infer.
  if (caption && caption.toLowerCase() !== ownerTitle.toLowerCase() && caption.length >= 8) {
    return { alt: trimTo(sentenceCase(caption)), source: "caption", needsManual: false };
  }

  if (ownerTitle) {
    let base = ownerTitle;
    if (kind === "collection") base = `${ownerTitle} collection`;

    // Anything the filename tells us that the title doesn't already say.
    const known = tokenSet(base);
    const extra = fileWords
      .split(" ")
      .filter((w) => w.length > 2 && !known.has(w))
      .slice(0, 5)
      .join(" ");

    if (extra) {
      return { alt: trimTo(`${base} – ${extra}`), source: "title+filename", needsManual: false };
    }
    const view = viewLabel(index);
    if (view) {
      return { alt: trimTo(`${base} – ${view}`), source: "title+view", needsManual: false };
    }
    return { alt: trimTo(base), source: "title", needsManual: false };
  }

  if (fileWords) {
    return { alt: trimTo(sentenceCase(fileWords)), source: "filename", needsManual: false };
  }

  return { alt: "", source: "none", needsManual: true };
}

