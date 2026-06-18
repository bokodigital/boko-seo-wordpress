import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { wpPost } from "@/lib/wp";

export const dynamic = "force-dynamic";

const VALID = ["pages", "posts", "postCategories", "products", "productCategories"];

export async function POST(request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not connected to a site." }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { type, id, metaTitle, metaDescription } = body || {};
  if (!VALID.includes(type) || !id || !metaTitle) {
    return NextResponse.json({ error: "type, id and metaTitle are required." }, { status: 400 });
  }
  try {
    await wpPost(session, "/update", {
      type,
      id,
      metaTitle,
      metaDesc: metaDescription || "",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: e.status || 500 });
  }
}
