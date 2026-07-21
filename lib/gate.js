// Free-tier gating for the Boko SEO Meta Studio.
//
// The first FREE_LIMIT items — counted across ALL content types combined
// (products, collections/categories, pages, posts/articles, etc.) — are free
// to generate and import. Once a connected site has more than FREE_LIMIT items,
// everything beyond the first FREE_LIMIT is "locked" and the merchant is
// prompted to upgrade with Boko.
//
// The upgrade destination is configurable with the UPGRADE_URL env var and
// defaults to a page on boko.com.au.

export const FREE_LIMIT = 10;

export function upgradeUrl() {
  return process.env.UPGRADE_URL || "https://www.boko.com.au/upgrade";
}

/**
 * Tag every item across the ordered groups with a global `locked` flag
 * (true once the running count passes FREE_LIMIT) and return gate metadata
 * for the UI. Mutates the item objects in place.
 *
 * @param {Array<Array<object>>} ordered - item arrays, in the fixed order they
 *   should be counted. The order is what decides which items fall in the free
 *   first-100, so keep it stable across requests.
 */
export function applyGate(ordered) {
  let i = 0;
  for (const group of ordered || []) {
    for (const item of group || []) {
      item.locked = i >= FREE_LIMIT;
      i += 1;
    }
  }
  const total = i;
  return {
    total,
    freeLimit: FREE_LIMIT,
    locked: total > FREE_LIMIT,
    lockedCount: Math.max(0, total - FREE_LIMIT),
    upgradeUrl: upgradeUrl(),
  };
}
