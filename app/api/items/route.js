import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { wpGet } from "@/lib/wp";
import { applyGate } from "@/lib/gate";
import { entitlementFromToken } from "@/lib/entitlement";
import { getAccountSession } from "@/lib/account-session";

export const dynamic = "force-dynamic";

// Decorate raw items from the bridge plugin into the shape the UI expects.
function decorate(type, arr) {
  return (arr || []).map((it) => ({
    type,
    id: it.id,
    title: it.title || "(untitled)",
    handle: it.slug || "",
    link: it.link || "",
    context: it.context || "",
    curTitle: it.metaTitle || "",
    curDesc: it.metaDesc || "",
  }));
}

export async function GET(request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }
  try {
    const d = await wpGet(session, "/items");
    const groups = d.groups || {};

    const pages = decorate("pages", groups.pages);
    const posts = decorate("posts", groups.posts);
    const postCategories = decorate("postCategories", groups.postCategories);
    const products = decorate("products", groups.products);
    const productCategories = decorate("productCategories", groups.productCategories);

    // Paid members get everything unlocked;
    // otherwise the first FREE_LIMIT items across ALL types are free and the
    // rest are tagged `locked`. Order here decides which land in the free tier.
    const account = getAccountSession(request);
    const entitlement = entitlementFromToken(account && account.bokoToken);
    const gate = applyGate([pages, posts, postCategories, products, productCategories], { entitlement });

    return NextResponse.json({
      connected: true,
      site: { name: d.site || session.site, seo: d.seo, woocommerce: d.woocommerce },
      pages,
      posts,
      postCategories,
      products,
      productCategories,
      gate,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
