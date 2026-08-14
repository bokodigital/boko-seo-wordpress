import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { wpGet } from "@/lib/wp";
import { applyGate } from "@/lib/gate";
import { verifyLicense } from "@/lib/license";
import { entitlementFromToken } from "@/lib/entitlement";
import { getAccountSession } from "@/lib/account-session";
import { suggestAlt } from "@/lib/alt-text";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_LIMIT = 100;

// Message shown when the site is still on Boko SEO Bridge v1.0.0, which has no
// /images route. The app stays usable — only the Alt tags tab needs the update.
const NEEDS_UPDATE =
  "Your site is running an older Boko SEO Bridge plugin. Update it to v1.1.0 to fix image alt text — " +
  "re-upload wp-plugin/boko-seo-bridge.php to wp-content/plugins/boko-seo-bridge/ and the tab will start working.";

// WooCommerce products get product-style wording ("alternate view"); everything
// else is treated as a plain post image.
function kindFor(parentType) {
  const t = String(parentType || "").toLowerCase();
  if (t.includes("product")) return "product";
  if (!t) return "media";
  return "post";
}

function decorate(raw) {
  const parentTitle = raw.parentTitle || "";
  const filename = raw.filename || raw.url || "";
  const kind = kindFor(raw.parentType);

  let s = suggestAlt({
    ownerTitle: parentTitle,
    filename,
    index: Number(raw.index) || 0,
    kind,
    // Only a real caption — WordPress defaults an attachment's title to its
    // filename, so that would just recycle junk like "IMG_4821".
    caption: raw.caption || "",
  });

  // Nothing usable from the parent or the filename? The attachment title is
  // the last signal worth trying before we ask a human.
  if (s.needsManual && raw.title) {
    const retry = suggestAlt({ ownerTitle: "", filename: raw.title, index: 0, kind });
    if (!retry.needsManual) s = retry;
  }

  return {
    key: `wp:${raw.id}`,
    kind: "attachment",
    id: raw.id,
    ownerId: raw.parentId || null,
    ownerTitle: parentTitle || "(not attached to a post)",
    ownerHandle: "",
    ownerLabel: raw.parentType || "Media library",
    ownerLink: raw.parentLink || "",
    editLink: raw.editLink || "",
    url: raw.url || "",
    thumb: raw.thumb || raw.url || "",
    filename: raw.filename || "",
    index: Number(raw.index) || 0,
    suggested: s.alt,
    needsManual: s.needsManual,
  };
}

export async function GET(request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }
  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "", 10) || DEFAULT_LIMIT));
  // Images the client already holds, so the free allowance carries across pages.
  const alreadyLoaded = Math.max(0, parseInt(url.searchParams.get("loaded") || "0", 10) || 0);

  try {
    const d = await wpGet(session, `/images?offset=${offset}&limit=${limit}`);
    const images = (d.images || []).map(decorate);

    const account = getAccountSession(request);
    const entitlement = entitlementFromToken(account && account.bokoToken);
    const member = verifyLicense(session.license, session.site);
    const gate = applyGate([images], { member, entitlement, startAt: alreadyLoaded });

    return NextResponse.json({
      connected: true,
      images,
      total: Number(d.total) || images.length,
      nextOffset: d.hasMore ? offset + (Number(d.limit) || limit) : null,
      bridgeVersion: d.version || "1.0.0",
      gate,
    });
  } catch (e) {
    if (e && e.status === 404) {
      return NextResponse.json({ error: NEEDS_UPDATE, needsPluginUpdate: true }, { status: 409 });
    }
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
