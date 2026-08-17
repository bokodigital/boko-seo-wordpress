import { NextResponse } from "next/server";
import {
  resolveEntitlement,
  ssoConfigured,
  FREE_ENTITLEMENT,
  accountsUrl,
} from "@/lib/entitlement";
import {
  getAccountSession,
  setAccountCookie,
  clearAccountCookie,
  persistGate,
} from "@/lib/account-session";
import { getSession } from "@/lib/session";
import { gateContext, siteNotice, siteLabel } from "@/lib/sites";

export const dynamic = "force-dynamic";

// GET /api/account — who's signed in, what plan are they on, and is the site
// they're connected to one their plan covers?
export async function GET(request) {
  const account = getAccountSession(request);

  // Claiming a site slot re-reads the membership on boko.com.au and hands back
  // a rolled token, so when that happens there's nothing left for
  // resolveEntitlement to do.
  const ctx = await gateContext(request, getSession(request));

  let entitlement = ctx.entitlement;
  let token = ctx.token;
  let changed = ctx.changed;
  if (!changed) {
    ({ entitlement, token, changed } = await resolveEntitlement(account || {}));
  }

  const res = NextResponse.json({
    ssoAvailable: ssoConfigured(),
    accountsUrl: accountsUrl() || null,
    ...entitlement,
    site: {
      connected: !!ctx.siteKey,
      label: siteLabel(ctx.siteKey),
      // null when coverage is beside the point: free account, or nothing connected.
      covered: ctx.applies ? ctx.covered : null,
      limit: ctx.limit,
      onPlan: (ctx.sites || []).map((s) => s.label || siteLabel(s.key)),
    },
    siteNotice: siteNotice(ctx),
  });

  // Persist a rolling token, or clear it if the membership is gone. Keep the
  // cached coverage record either way, so the next request doesn't re-check.
  if (changed) {
    if (token) setAccountCookie(res, token, { site: ctx.coverage || (account && account.site) });
    else clearAccountCookie(res);
    return res;
  }
  return persistGate(res, ctx);
}

// DELETE /api/account — sign out of the Boko membership (keeps the site connected).
export async function DELETE() {
  return clearAccountCookie(NextResponse.json({ ...FREE_ENTITLEMENT, signedIn: false }));
}
