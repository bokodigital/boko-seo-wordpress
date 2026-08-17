// Membership entitlement, resolved from the Boko Accounts plugin on boko.com.au.
//
// A member signs in there with their ProfilePress account; WordPress hands back
// an HMAC-signed token describing their plan and limits. We verify the signature
// locally (fast, no network) and re-check with WordPress periodically so that a
// cancelled or lapsed subscription actually loses access.
//
// Env:
//   BOKO_ACCOUNTS_URL     e.g. https://boko.com.au   (required for SSO)
//   BOKO_ACCOUNTS_SECRET  same value as the plugin's shared secret
//
// If either is unset, SSO is simply unavailable and everyone is on the free
// tier. It never fails open.

import crypto from "crypto";

// Must stay in step with Boko_Accounts::tiers() in the WordPress plugin.
// The plugin is the source of truth; this is the fallback when a token predates
// a tier change or the plan is unrecognised.
export const TIERS = {
  free: { label: "Free", stores: 1, itemsPerMonth: 10, autoOptimise: false, reAudit: false },
  "store-fix": { label: "Store Fix", stores: 1, itemsPerMonth: 2000, autoOptimise: true, reAudit: true },
  agency: { label: "Agency", stores: 10, itemsPerMonth: 0, autoOptimise: true, reAudit: true },
};

export const FREE_ENTITLEMENT = {
  plan: "free",
  planLabel: "Free",
  email: "",
  name: "",
  userId: null,
  limits: { ...TIERS.free },
  signedIn: false,
};

export function accountsUrl() {
  return String(process.env.BOKO_ACCOUNTS_URL || "").trim().replace(/\/+$/, "");
}

export function ssoConfigured() {
  return !!accountsUrl() && !!String(process.env.BOKO_ACCOUNTS_SECRET || "").trim();
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/**
 * Verify a token minted by the WordPress plugin.
 * Returns the payload, or null if the signature, format or expiry is wrong.
 */
export function verifyToken(token) {
  const secret = String(process.env.BOKO_ACCOUNTS_SECRET || "").trim();
  if (!secret) return null;
  const t = String(token || "").trim();
  const dot = t.indexOf(".");
  if (dot < 1) return null;

  const body = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch (e) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) return null;
  return payload;
}

/** Normalise a verified payload into the shape the app uses everywhere. */
export function toEntitlement(payload) {
  if (!payload) return { ...FREE_ENTITLEMENT };
  const tier = TIERS[payload.plan] || TIERS.free;
  const limits = payload.limits && typeof payload.limits === "object" ? payload.limits : tier;
  return {
    signedIn: true,
    userId: payload.userId || null,
    email: payload.email || "",
    name: payload.name || "",
    plan: payload.plan || "free",
    planLabel: payload.planLabel || tier.label,
    limits: {
      stores: Number(limits.stores) || tier.stores,
      // 0 means unlimited — keep it as 0 rather than coercing to a falsy default.
      itemsPerMonth:
        limits.itemsPerMonth === 0 ? 0 : Number(limits.itemsPerMonth) || tier.itemsPerMonth,
      autoOptimise: !!limits.autoOptimise,
      reAudit: !!limits.reAudit,
    },
  };
}

/**
 * Ask WordPress for the member's CURRENT plan. This is what makes cancellation
 * work — the signed token alone would keep granting access until it expired.
 * Returns { entitlement, token } or null if the account or token is no longer good.
 */
export async function refreshEntitlement(token) {
  const base = accountsUrl();
  if (!base || !token) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(`${base}/wp-json/boko-account/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.token) return null;
    // Re-verify what WordPress sent, so a compromised DNS/proxy can't inflate a plan.
    const payload = verifyToken(d.token);
    if (!payload) return null;
    return { entitlement: toEntitlement(payload), token: d.token };
  } catch (e) {
    return null;
  }
}

/** How stale a cached entitlement may get before we re-check with WordPress. */
export const REVALIDATE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resolve the entitlement for a request's session, refreshing from WordPress
 * when the cached copy is stale.
 *
 * Returns { entitlement, token, changed } — `changed` tells the caller to write
 * the refreshed token back into the session cookie.
 */
export async function resolveEntitlement(session) {
  const token = session && session.bokoToken;
  if (!token) return { entitlement: { ...FREE_ENTITLEMENT }, token: null, changed: false };

  const checkedAt = Number(session.bokoCheckedAt) || 0;
  const fresh = Date.now() - checkedAt < REVALIDATE_AFTER_MS;

  if (fresh) {
    const payload = verifyToken(token);
    if (payload) return { entitlement: toEntitlement(payload), token, changed: false };
  }

  const refreshed = await refreshEntitlement(token);
  if (refreshed) {
    return { entitlement: refreshed.entitlement, token: refreshed.token, changed: true };
  }

  // WordPress said no, or is unreachable. If the cached token is still validly
  // signed and unexpired, honour it rather than locking a paying customer out
  // over a blip; otherwise drop to free.
  const payload = verifyToken(token);
  if (payload) return { entitlement: toEntitlement(payload), token, changed: false };
  return { entitlement: { ...FREE_ENTITLEMENT }, token: null, changed: true };
}

/* ------------------------- per-request convenience ------------------------- */

// Data routes verify the token locally (no network) — fast, and safe because
// the token is short-lived. /api/account is the single place that re-checks
// with WordPress and rolls the cookie, so a cancellation takes effect within
// REVALIDATE_AFTER_MS of the member next loading the app.
export function entitlementFromToken(token) {
  if (!token) return { ...FREE_ENTITLEMENT };
  const payload = verifyToken(token);
  if (!payload) return { ...FREE_ENTITLEMENT };
  return toEntitlement(payload);
}

/** True when the plan is anything above free. */
export function isPaid(entitlement) {
  return !!entitlement && entitlement.plan && entitlement.plan !== "free";
}
