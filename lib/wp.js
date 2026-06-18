// Server-only helper to call the Boko SEO Bridge plugin on the connected
// WordPress site, authenticated with an Application Password (HTTP Basic).

function normalizeSite(site) {
  let s = String(site || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

function authHeader(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export async function wpGet(session, path) {
  const url = normalizeSite(session.site) + "/wp-json/boko-seo/v1" + path;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(session.user, session.pass) },
    cache: "no-store",
  });
  return parse(res);
}

export async function wpPost(session, path, body) {
  const url = normalizeSite(session.site) + "/wp-json/boko-seo/v1" + path;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(session.user, session.pass),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  return parse(res);
}

async function parse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg =
      (json && (json.message || json.error)) ||
      (res.status === 401 || res.status === 403
        ? "Authentication failed. Check the username and application password."
        : res.status === 404
        ? "Boko SEO Bridge plugin not found on this site. Install the companion plugin."
        : `Request failed (${res.status}).`);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

export { normalizeSite };
