// Which sites a member's plan actually covers.
//
// A Boko plan buys a number of SITES, not a number of apps: Store Fix covers
// one, Agency ten, counted across the Shopify and WordPress studios together.
// Connecting one Shopify store and one WordPress site is two sites, not one
// each.
//
// The registry lives in the member's WordPress user meta on boko.com.au, so a
// slot survives a cleared cookie, a different browser, and a move between the
// two apps. The first site a member connects claims a slot and keeps it.
//
// Going over the limit is NOT a hard block. The extra site still works, on the
// free item allowance, with a banner naming the site the plan does cover.
// Slots are freed by Boko in Settings → Boko Accounts → Check a member.

import {
  accountsUrl,
  verifyToken,
  toEntitlement,
  entitlementFromToken,
  isPaid,
} from "@/lib/entitlement";
import { getAccountSession } from "@/lib/account-session";

/** This app's half of the site key. The Shopify studio uses "shopify". */
export const APP_KIND = "wordpress";

/** How long a coverage answer is trusted before we re-check with boko.com.au. */
export const COVERAGE_TTL_MS = 15 * 60 * 1000;

/**
 * Canonical identity for a site. Must produce byte-identical output to
 * Boko_Accounts::normalise_site() in the WordPress plugin, or a member's own
 * site won't match its own slot.
 *
 *   "Acme.com.au/"       -> "wordpress:acme.com.au"
 *   "www.acme.com.au"    -> "wordpress:acme.com.au"
 *   "acme.com.au/shop"   -> "wordpress:acme.com.au/shop"
 *   "acme.myshopify.com" -> "shopify:acme.myshopify.com"
 */
export function normaliseSite(app, site) {
  const a = String(app || "").toLowerCase().trim();
  if (a !== "shopify" && a !== "wordpress") return "";
  let raw = String(site || "").trim();
  if (!raw) return "";
  if (!raw.includes("//")) raw = "https://" + raw;
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return "";
  }
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return "";
  // A non-default port is part of the identity — staging on :8080 is not the
  // same site as production on the same host.
  if (u.port) host += ":" + u.port;
  if (a === "shopify") return "shopify:" + host;
  return "wordpress:" + host + u.pathname.replace(/\/+$/, "");
}

/** The readable half of a site key: "wordpress:acme.com.au" -> "acme.com.au". */
export function siteLabel(key) {
  const s = String(key || "");
  const i = s.indexOf(":");
  return i === -1 ? s : s.slice(i + 1);
}

/** The site a connected session points at. */
export function siteOf(session) {
  return (session && session.site) || "";
}

export function siteKeyOf(session) {
  return normaliseSite(APP_KIND, siteOf(session));
}

/**
 * Ask boko.com.au to claim a slot for this site, or tell us the plan is full.
 * Returns null if SSO isn't configured or WordPress can't be reached.
 */
export async function claimSite(token, site) {
  const base = accountsUrl();
  if (!base || !token) return null;
  const key = normaliseSite(APP_KIND, site);
  if (!key) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(`${base}/wp-json/boko-account/v1/sites`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ app: APP_KIND, site }),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.token) return null;

    // Re-verify the signature rather than trusting the response body, so a
    // hijacked DNS or proxy can't hand out coverage it shouldn't.
    const payload = verifyToken(d.token);
    if (!payload) return null;

    return {
      entitlement: toEntitlement(payload),
      token: d.token,
      coverage: {
        key,
        covered: !!payload.covered,
        limit: Number(payload.siteLimit) || 0,
        sites: (Array.isArray(payload.sites) ? payload.sites : []).map((s) => ({
          key: String(s.key || ""),
          app: String(s.app || ""),
          label: String(s.label || siteLabel(s.key)),
        })),
        checkedAt: Date.now(),
      },
    };
  } catch (e) {
    return null;
  }
}

/**
 * Everything a data route needs to gate a response: the member's plan, and
 * whether the site they're pointed at is one their plan covers.
 *
 * @returns {Promise<{
 *   entitlement: object, siteKey: string, covered: boolean, applies: boolean,
 *   sites: Array, limit: number, token: string|null, changed: boolean,
 *   coverage: object|null
 * }>}
 *   `applies` is false when site coverage is beside the point — nobody signed
 *   in, a free account, or no site connected yet. `changed` means the caller
 *   should write `coverage`/`token` back to the account cookie.
 */
export async function gateContext(request, session) {
  const account = getAccountSession(request);
  const token = (account && account.bokoToken) || null;
  const entitlement = entitlementFromToken(token);
  const siteKey = siteKeyOf(session);
  const rec = (account && account.site) || null;

  const base = {
    entitlement,
    siteKey,
    covered: false,
    applies: false,
    sites: [],
    limit: Number(entitlement.limits && entitlement.limits.stores) || 0,
    token,
    changed: false,
    coverage: null,
  };

  // Free accounts are limited by the item allowance, not by site — and a
  // signed-out visitor has nothing to bind a slot to.
  if (!isPaid(entitlement) || !siteKey) return base;

  const fresh = rec && rec.key === siteKey && Date.now() - (Number(rec.checkedAt) || 0) < COVERAGE_TTL_MS;
  if (fresh) {
    return {
      ...base,
      applies: true,
      covered: !!rec.covered,
      sites: rec.sites || [],
      limit: Number(rec.limit) || base.limit,
    };
  }

  const claimed = await claimSite(token, siteOf(session));
  if (claimed) {
    return {
      entitlement: claimed.entitlement,
      siteKey,
      applies: true,
      covered: claimed.coverage.covered,
      sites: claimed.coverage.sites,
      limit: claimed.coverage.limit || base.limit,
      token: claimed.token,
      changed: true,
      coverage: claimed.coverage,
    };
  }

  // boko.com.au is unreachable. Fall back to the last answer we had for THIS
  // site; if we've never had one, give the member the benefit of the doubt
  // rather than downgrading a paying customer during someone else's outage.
  // Nothing is cached, so the real answer applies again on the next request.
  if (rec && rec.key === siteKey) {
    return {
      ...base,
      applies: true,
      covered: !!rec.covered,
      sites: rec.sites || [],
      limit: Number(rec.limit) || base.limit,
    };
  }
  return { ...base, applies: true, covered: true, provisional: true };
}

/**
 * The bit of gate context the UI needs to explain itself.
 * `covered: true` (or `applies: false`) means there is nothing to say.
 */
export function siteNotice(ctx) {
  if (!ctx || !ctx.applies || ctx.covered) return null;
  return {
    siteKey: ctx.siteKey,
    site: siteLabel(ctx.siteKey),
    limit: ctx.limit,
    planLabel: ctx.entitlement.planLabel,
    coveredSites: (ctx.sites || []).map((s) => s.label || siteLabel(s.key)),
  };
}
