// One source of truth for "is this meta good enough?".
//
// The important distinction: there is a difference between "not ideal" and
// "actually a problem". A 45-character title is perfectly fine on Google — it
// just isn't using all the space available. Flagging that as an error trains
// people to ignore warnings, so only the genuine problems warn.
//
//   PROBLEM  — too short to be useful, or long enough that Google truncates it
//   OK       — inside the safe band, just not making the most of the space
//   IDEAL    — the sweet spot
//
// Sources for the bands are in the README; they follow current Google
// truncation behaviour rather than folklore.

export const LIMITS = {
  title: {
    label: "Meta title",
    // Ideal: 50–60 characters (~600px). Under 30 misses keywords; over 60 is
    // cut off with an ellipsis.
    idealMin: 50,
    idealMax: 60,
    min: 30,
    max: 60,
  },
  description: {
    label: "Meta description",
    // Ideal: 120–158 characters (~960px on desktop). Under 70 wastes the
    // space; over 160 gets clipped.
    idealMin: 120,
    idealMax: 158,
    min: 70,
    max: 160,
  },
};

/** Alt text: at most 125 characters, and more than a word or two. */
export const ALT_MAX = 125;
export const ALT_MIN_WORDS = 3;

function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Audit a meta title or description.
 * @param {string} value
 * @param {"title"|"description"} kind
 * @returns {{state:string, msg:string, ok:boolean, hasIssue:boolean}}
 *   state: missing | short | long | ok | ideal
 *   hasIssue: true only for missing / short / long
 */
export function auditLength(value, kind) {
  const L = LIMITS[kind];
  const v = String(value || "").trim();
  const n = v.length;

  if (!n) {
    return { state: "missing", msg: `${L.label} missing`, ok: false, hasIssue: true };
  }
  if (n > L.max) {
    return {
      state: "long",
      msg: `${L.label} too long (${n}) — Google cuts off after ${L.max}`,
      ok: false,
      hasIssue: true,
    };
  }
  if (n < L.min) {
    return {
      state: "short",
      msg: `${L.label} too short (${n}) — aim for at least ${L.min}`,
      ok: false,
      hasIssue: true,
    };
  }
  if (n >= L.idealMin && n <= L.idealMax) {
    return { state: "ideal", msg: `${L.label} ideal (${n})`, ok: true, hasIssue: false };
  }
  // Inside the safe band but not making the most of it. Not a problem.
  return {
    state: "ok",
    msg: `${L.label} fine (${n}) — ${L.idealMin}–${L.idealMax} is ideal`,
    ok: true,
    hasIssue: false,
  };
}

/** Audit one item's title + description together. */
export function auditItem(item) {
  const title = auditLength(item && item.curTitle, "title");
  const desc = auditLength(item && item.curDesc, "description");
  return { title, desc, hasIssue: title.hasIssue || desc.hasIssue };
}

/**
 * Audit image alt text. Length is capped at 125 characters; the lower bound is
 * about words, not characters — "Blue shirt" is short but perfectly descriptive,
 * whereas a one-word alt usually isn't.
 */
export function auditAlt(alt) {
  const v = String(alt || "").replace(/\s+/g, " ").trim();
  const n = v.length;
  const words = countWords(v);

  if (!n) return { state: "missing", msg: "Alt text missing", ok: false, hasIssue: true };
  if (n > ALT_MAX) {
    return {
      state: "long",
      msg: `Too long (${n}) — keep alt text under ${ALT_MAX} characters`,
      ok: false,
      hasIssue: true,
    };
  }
  if (/^(an?\s+)?(image|photo|photograph|picture|pic|screenshot|graphic)\s+(of|showing)\s+/i.test(v)) {
    return {
      state: "weak",
      msg: 'Drop the "image of" opener — screen readers already say it\'s an image',
      ok: false,
      hasIssue: true,
    };
  }
  if (words < ALT_MIN_WORDS) {
    return {
      state: "short",
      msg: `Only ${words} word${words === 1 ? "" : "s"} — add a little context`,
      ok: false,
      hasIssue: true,
    };
  }
  return { state: "ok", msg: `Alt text OK (${n})`, ok: true, hasIssue: false };
}

/** Class for the little character-count chip: lime when fine, dark when not. */
export function counterClass(value, kind) {
  return auditLength(value, kind).ok ? "ok" : "warn";
}

export function altCounterClass(alt) {
  return auditAlt(alt).ok ? "ok" : "warn";
}
