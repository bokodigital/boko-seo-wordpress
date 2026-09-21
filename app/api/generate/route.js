import { NextResponse } from "next/server";
import { FREE_LIMIT, upgradeUrl } from "@/lib/gate";
import { buildMetaTitle, guessKeyword } from "@/lib/meta-title";

export const dynamic = "force-dynamic";

/**
 * AI-powered meta generation (Google Gemini) with a rule-based fallback.
 *
 * Drop-in replacement for app/api/generate/route.js in BOTH the WordPress and
 * Shopify Boko SEO apps. The request/response shape is unchanged:
 *   IN : { type, title, handle?, context, store }
 *   OUT: { metaTitle, metaDescription, source }   ("source" is "ai" or "rules")
 *
 * - Meta titles always take the shape "Page title | Keyword | Site name",
 *   sentence case, "|" separators — assembled by lib/meta-title.js whichever
 *   path produced the parts, so the format can't drift.
 * - When GEMINI_API_KEY is set, the keyword and description are written by the
 *   model, specific to each item.
 * - When the key is missing, or the AI call errors/times out, it falls back to
 *   the original free, rule-based logic so the app never breaks.
 *
 * Env:
 *   GEMINI_API_KEY  required for AI. Free key: https://aistudio.google.com/apikey
 *   GEMINI_MODEL    optional. Tried first, then "gemini-flash-latest" (Google's
 *                   auto-updating alias), then "gemini-2.5-flash" — so a
 *                   retired model name can't silently switch AI off again.
 */

// Generation aims for the IDEAL band, not merely the acceptable one, so
// anything this produces passes the audit cleanly.
// Audit bands live in lib/seo-audit.js: title ideal 50-60 (hard max 60),
// description ideal 120-158 (hard max 160). We target the top of the
// description band and cap at 158 so output is always inside "ideal".
const TITLE_MAX = 60, DESC_MIN = 140, DESC_MAX = 158;

const TYPE_WORD = {
  products: "product",
  collections: "collection",
  pages: "page",
  articles: "article",
  posts: "article",
  categories: "category",
  post_categories: "category",
  product_categories: "product category",
};

function clean(s) {
  return (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function trimWords(s, max) {
  if (s.length <= max) return s;
  let t = s.slice(0, max);
  const i = t.lastIndexOf(" ");
  if (i > max * 0.6) t = t.slice(0, i);
  return t.trim().replace(/[\s,;:.\-–|]+$/, "");
}

/* ----------------------------- rule-based (fallback) ----------------------------- */

// "Page title | Keyword | Site name". Without AI the keyword is the phrase the
// page's own copy repeats most; if it repeats nothing useful, the keyword slot
// is left out rather than filled with something made up.
function makeTitle(title, store, context) {
  return buildMetaTitle({
    page: title,
    keyword: guessKeyword({ title, context }),
    site: store,
    context,
  });
}

function makeDesc(context, title, store, typeWord) {
  let text = clean(context);
  if (!text) {
    text = `Discover ${clean(title)}${store ? ` at ${store}` : ""}.`;
  }
  if (text.length > DESC_MAX) return trimWords(text, DESC_MAX);

  const fillers = [
    store ? `Shop this ${typeWord} at ${store} today.` : `Shop this ${typeWord} today.`,
    `Enjoy quality you can trust, fast shipping and easy returns.`,
    `Browse the full range and order online now.`,
    store ? `${store} — great value, every day.` : `Great value, every day.`,
  ];

  let out = text;
  for (const f of fillers) {
    if (out.length >= DESC_MIN) break;
    const add = (out.endsWith(".") ? " " : ". ") + f;
    if ((out + add).length <= DESC_MAX) out += add;
  }
  if (out.length > DESC_MAX) out = trimWords(out, DESC_MAX);
  return out;
}

function ruleBased({ title, context, store, typeWord }) {
  return {
    metaTitle: makeTitle(title || "", store || "", context || ""),
    metaDescription: makeDesc(context || "", title || "", store || "", typeWord),
    source: "rules",
  };
}

/* --------------------------------- AI (Gemini) --------------------------------- */

function buildPrompt({ title, context, store, typeWord }) {
  const ctx = clean(context).slice(0, 1400);
  return [
    `You are an expert SEO copywriter${store ? ` for the brand "${store}"` : ""}.`,
    `For the ${typeWord} below, write the parts of its meta title, and its meta description.`,
    ``,
    `The meta title is assembled as:  PAGE TITLE | KEYWORD | ${store || "SITE NAME"}`,
    `and must fit in ${TITLE_MAX} characters in total, so keep the parts short.`,
    ``,
    `Rules:`,
    `- pageTitle: the name of this ${typeWord}, as a shopper would recognise it. Use the item's own title; shorten it only if it is longer than about 28 characters. Do not include the brand name.`,
    `- keyword: the single search phrase (2-4 words) a real customer would type into Google to find this ${typeWord}. Must add something the page title doesn't already say — never repeat it. Do not include the brand name.`,
    `- Write pageTitle and keyword in sentence case: only the first letter capitalised, everything else lowercase, EXCEPT proper nouns (brands, places, product names like iPhone) and acronyms (SEO, AI). Never Title Case.`,
    `- metaDescription: ${DESC_MIN}-${DESC_MAX} characters (Google shows up to about 158). Naturally include the keyword plus one related term. Describe THIS specific ${typeWord} using real details from the content — no filler like "great value every day". End with a soft call to action that suits a ${typeWord} (e.g. "Shop now", "Discover the range", "Read more"). Australian English spelling.`,
    `- No quotes, no emojis, no ALL CAPS, no clickbait. Never invent prices, discounts, guarantees or facts not present in the content.`,
    ``,
    `ITEM`,
    `Type: ${typeWord}`,
    `Title: ${clean(title) || "(untitled)"}`,
    store ? `Brand: ${store}` : ``,
    ctx ? `Content: ${ctx}` : `Content: (none provided — infer from the title)`,
  ].filter(Boolean).join("\n");
}

// gemini-2.0-flash was the old default. Once Google retired it every request
// 404'd and the app quietly fell back to rule-based titles for everything.
// Trying an alias next means a retired name degrades to "slightly different
// model", not "no AI".
function modelsToTry() {
  const list = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash"];
  return [...new Set(list.map((m) => String(m || "").trim()).filter(Boolean))];
}

async function callGemini(model, key, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function aiGenerate(input) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const payload = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          pageTitle: { type: "STRING" },
          keyword: { type: "STRING" },
          metaDescription: { type: "STRING" },
        },
        required: ["pageTitle", "keyword", "metaDescription"],
      },
    },
  };

  let res;
  for (const model of modelsToTry()) {
    res = await callGemini(model, key, payload);
    // 404 = unknown or retired model name: try the next one. Anything else
    // (bad key, quota, a real answer) is final.
    if (res.status !== 404) break;
    console.error(`Gemini model "${model}" not found, trying the next one`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty AI response");

  const parsed = JSON.parse(text);
  // The model writes the parts; the shape and casing are enforced here.
  const metaTitle = buildMetaTitle({
    page: clean(parsed.pageTitle) || input.title,
    keyword: clean(parsed.keyword),
    site: input.store,
    context: input.context,
  });
  let metaDescription = clean(parsed.metaDescription);
  if (metaDescription.length > DESC_MAX) metaDescription = trimWords(metaDescription, DESC_MAX);

  // Reject clearly unusable output so we fall back gracefully.
  if (!metaTitle || metaDescription.length < 70) return null;

  return { metaTitle, metaDescription, source: "ai" };
}

/* ----------------------------------- handler ----------------------------------- */

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, title, context, store, locked } = body || {};

  // Free-tier gate: items beyond the free first-100 are locked.
  if (locked) {
    return NextResponse.json(
      {
        error: `Your free plan covers the first ${FREE_LIMIT} items. Upgrade with Boko to optimise the rest.`,
        upgradeUrl: upgradeUrl(),
      },
      { status: 402 }
    );
  }
  const typeWord = TYPE_WORD[type] || "page";
  const input = { title: title || "", context: context || "", store: store || "", typeWord };

  // aiStatus says why the rule-based fallback was used, so "the titles look
  // generic" can be diagnosed from the browser. It carries the HTTP status and
  // Google's short error reason only — never the key or the prompt.
  let aiStatus = process.env.GEMINI_API_KEY ? "" : "no-key";
  try {
    const ai = await aiGenerate(input);
    if (ai) return NextResponse.json(ai);
    if (!aiStatus) aiStatus = "unusable-output";
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("AI meta generation failed, falling back to rules:", msg);
    const m = msg.match(/^Gemini (\d{3})/);
    const reason = (msg.match(/"status":\s*"([A-Z_]+)"/) || [])[1] || "";
    aiStatus = m ? `http-${m[1]}${reason ? " " + reason : ""}` : e && e.name === "AbortError" ? "timeout" : "error";
  }

  return NextResponse.json({ ...ruleBased(input), aiStatus });
}
