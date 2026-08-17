// Free-tier gating for the Boko SEO Meta Studio.
//
// The first FREE_LIMIT items — counted across ALL content types combined
// (products, collections/categories, pages, posts/articles, etc.) — are free
// to generate and import. Once a connected site has more than FREE_LIMIT items,
// everything beyond the first FREE_LIMIT is "locked" and the merchant is
// prompted to upgrade with Boko.
//
// The upgrade destination is configurable with the UPGRADE_URL env var and
// defaults to the Studio product page on boko.com.au.

import { siteNotice } from "@/lib/sites";

export const FREE_LIMIT = 10;

export function upgradeUrl() {
  return process.env.UPGRADE_URL || "https://boko.com.au/ai-tools/seo-meta-studio-by-boko/";
}

/**
 * Tag every item across the ordered groups with a global `locked` flag
 * (true once the running count passes FREE_LIMIT) and return gate metadata
 * for the UI. Mutates the item objects in place.
 *
 * @param {object} [opts] - { entitlement } the member's resolved plan; any
 *   plan above free unlocks everything.
 *   { startAt } seeds the running count, for scans that arrive in more than one
 *   request (the alt-tag scanner pages through a big catalogue) so the free
 *   allowance isn't handed out again on every page.
 * @param {Array<Array<object>>} ordered - item arrays, in the fixed order they
 *   should be counted. The order is what decides which items fall in the free
 *   first-100, so keep it stable across requests.
 */
export function applyGate(ordered, opts = {}) {
  // Two things have to be true to unlock the app: the member is on a paid Boko
  // plan (resolved by SSO against boko.com.au), and the site they've connected
  // is one of the sites that plan covers. A Store Fix member on their second
  // site is still a paying customer — they just fall back to the free
  // allowance here, with a banner saying so.
  const site = opts.site || null;
  const ent = opts.entitlement || (site && site.entitlement) || null;
  const paid = !!(ent && ent.plan && ent.plan !== "free");
  const covered = !site || !site.applies || !!site.covered;
  const member = paid && covered;
  const startAt = Math.max(0, Number(opts.startAt) || 0);
  let i = startAt;
  for (const group of ordered || []) {
    for (const item of group || []) {
      item.locked = member ? false : i >= FREE_LIMIT;
      i += 1;
    }
  }
  const total = i;
  return {
    total,
    freeLimit: FREE_LIMIT,
    member,
    locked: !member && total > FREE_LIMIT,
    lockedCount: member ? 0 : Math.max(0, total - FREE_LIMIT),
    upgradeUrl: upgradeUrl(),
    plan: ent ? ent.plan : "free",
    planLabel: ent ? ent.planLabel : "Free",
    signedIn: !!(ent && ent.signedIn),
    paid,
    siteCovered: covered,
    siteNotice: siteNotice(site),
  };
}
