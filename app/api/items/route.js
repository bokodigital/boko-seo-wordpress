import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { wpGet } from "@/lib/wp";

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
    return NextResponse.json({
      connected: true,
      site: { name: d.site || session.site, seo: d.seo, woocommerce: d.woocommerce },
      pages: decorate("pages", groups.pages),
      posts: decorate("posts", groups.posts),
      postCategories: decorate("postCategories", groups.postCategories),
      products: decorate("products", groups.products),
      productCategories: decorate("productCategories", groups.productCategories),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
