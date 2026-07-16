import { NextResponse } from "next/server";
import { FREE_LIMIT, upgradeUrl } from "@/lib/gate";

export const dynamic = "force-dynamic";

/**
 * AI-powered meta generation (Google Gemini) with a rule-based fallback.
 *
 * Drop-in replacement for app/api/generate/route.js in BOTH the WordPress and
 * Shopify Boko SEO apps. The request/response shape is unchanged:
 *   IN : { type, title, handle?, context, store }
 *   OUT: { metaTitle, metaDescription, source }   ("source" is "ai" or "rules")
 *
 * - When GEMINI_API_KEY is set, titles/descriptions are written by the model,
 *   keyword-led and specific to each item.
 * - When the key is missing, or the AI call errors/times out, it falls back to
 *   the original free, rule-based logic so the app never breaks.
 *
 * Env:
 *   GEMINI_API_KEY  required for AI. Free key: https://aistudio.google.com/apikey
 *   GEMINI_MODEL    optional, default "gemini-2.0-flash"
 */

const TITLE_MIN = 50, TITLE_MAX = 60, DESC_MIN = 150, DESC_MAX = 160;

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

/* ------------------------------ rule-based (fallback) ------------------------------ */

function makeTitle(title, store) {
  const base = clean(title);
  if (base.length >= TITLE_MIN && base.length <= TITLE_MAX) return base;
  if (base.length > TITLE_MAX) return trimWords(base, TITLE_MAX);

  const tails = store
    ? [` | ${store}`, ` – Shop ${store}`, ` | ${store} Online Store`, ` – Buy Online at ${store}`]
    : [` | Shop Online`, ` – Buy Online Today`, ` | Free Shipping & Returns`];

  let best = base;
  for (const t of tails) {
    const cand = base + t;
    if (cand.length <= TITLE_MAX) {
      if (cand.length >= TITLE_MIN) return cand;
      if (cand.length > best.length) best = cand;
    }
  }
  return best;
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
    metaTitle: makeTitle(title || "", store || ""),
    metaDescription: makeDesc(context || "", title || "", store || "", typeWord),
    source: "rules",
  };
}

/* ---------------------------------- AI (Gemini) ---------------------------------- */

function buildPrompt({ title, context, store, typeWord }) {
  const ctx = clean(context).slice(0, 1400);
  return [
    `You are an expert SEO copywriter${store ? ` for the brand "${store}"` : ""}.`,
    `Write ONE Google-search-optimised meta title and ONE meta description for the ${typeWord} below.`,
    ``,
    `Rules:`,
    `- META TITLE: ${TITLE_MIN}-${TITLE_MAX} characters. Lead with the single most important keyword a real shopper would search for this ${typeWord}. Be specific and compelling — never generic. Add the brand "${store || ""}" at the end (after " | " or " – ") only if it still fits under ${TITLE_MAX} characters. No ALL CAPS, no quotes, no emojis, no clickbait.`,
    `- META DESCRIPTION: ${DESC_MIN}-${DESC_MAX} characters. Naturally include the primary keyword plus one related term. Describe THIS specific ${typeWord} using real details from the content — no filler like "great value every day". End with a soft call to action that suits a ${typeWord} (e.g. "Shop now", "Discover the range", "Read more"). Australian English spelling.`,
    `- Never invent prices, discounts, guarantees or facts not present in the content.`,
    `- Stay within the character limits.`,
    ``,
    `ITEM`,
    `Type: ${typeWord}`,
    `Title: ${clean(title) || "(untitled)"}`,
    store ? `Brand: ${store}` : ``,
    ctx ? `Content: ${ctx}` : `Content: (none provided — infer from the title)`,
  ].filter(Boolean).join("\n");
}

async function aiGenerate(input) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          metaTitle: { type: "STRING" },
          metaDescription: { type: "STRING" },
        },
        required: ["metaTitle", "metaDescription"],
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty AI response");

  const parsed = JSON.parse(text);
  let metaTitle = clean(parsed.metaTitle);
  let metaDescription = clean(parsed.metaDescription);

  // Enforce hard max lengths; keep AI copy otherwise.
  if (metaTitle.length > TITLE_MAX) metaTitle = trimWords(metaTitle, TITLE_MAX);
  if (metaDescription.length > DESC_MAX) metaDescription = trimWords(metaDescription, DESC_MAX);

  // Reject clearly unusable output so we fall back gracefully.
  if (metaTitle.length < 15 || metaDescription.length < 60) return null;

  return { metaTitle, metaDescription, source: "ai" };
}

/* ------------------------------------ handler ------------------------------------ */

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

  try {
    const ai = await aiGenerate(input);
    if (ai) return NextResponse.json(ai);
  } catch (e) {
    // Swallow and fall back to rule-based below.
    console.error("AI meta generation failed, falling back to rules:", e?.message || e);
  }

  return NextResponse.json(ruleBased(input));
}
