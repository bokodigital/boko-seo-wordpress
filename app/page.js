"use client";

import { useEffect, useMemo, useState, useCallback, useDeferredValue } from "react";

const TITLE_MIN = 50, TITLE_MAX = 60, DESC_MIN = 150, DESC_MAX = 160;
const PAGE_SIZE = 10;

const ALL_TABS = [
  { key: "pages", label: "Pages", woo: false },
  { key: "posts", label: "Posts", woo: false },
  { key: "postCategories", label: "Post categories", woo: false },
  { key: "products", label: "Products", woo: true },
  { key: "productCategories", label: "Product categories", woo: true },
];

function Logo() {
  return (
    <svg viewBox="5750 -2679.9 12500 4447.2" role="img" aria-label="boko">
      <path fill="#111213" d="M7218.1-1163.5h-880.7v-1237.2c0-203.6-103-279.3-230-279.3H5750v1516.3l293.1,0.1H5750V302c0,809.2,657.3,1465.3,1468.1,1465.3s1468.1-656,1468.1-1465.3S8029-1163.5,7218.1-1163.5z M7218.2,1181.3c-486.5,0-880.8-393.6-880.8-879.3v-879.3h880.8c486.5,0,880.8,393.6,880.8,879.3C8099.1,787.5,7704.7,1181.3,7218.2,1181.3z" />
      <path fill="#111213" d="M11286.9,302c0-485.6-394.3-879.3-880.8-879.3c-486.5,0-880.9,393.6-880.9,879.3s394.3,879.3,880.9,879.3C10892.6,1181.1,11286.9,787.5,11286.9,302z M11874.2,302c0,809.3-657.3,1465.3-1468.1,1465.3S8938,1111.2,8938,302c0-809.3,657.3-1465.3,1468.1-1465.3C11216.9-1163.5,11874.2-507.3,11874.2,302z" />
      <path fill="#BFFC00" d="M13174.5,1181.1c-14.8,0-29.6-0.7-44.1-2.1l1927.5-1923.7l-415.3-414.4L12715.2,764.6c-1.4-14.5-2.1-29.2-2.1-44v-1884.1h-587.3V720.6c0,578.1,469.4,1046.7,1048.6,1046.7H15062v-586.2H13174.5L13174.5,1181.1z" />
      <path fill="#111213" d="M17662.7,302c0-485.6-394.3-879.3-880.8-879.3s-880.9,393.6-880.9,879.3s394.5,879.3,880.9,879.3C17268.4,1181.3,17662.7,787.5,17662.7,302z M18250,302c0,809.3-657.3,1465.3-1468.1,1465.3c-810.9,0-1468.1-656.1-1468.1-1465.3c0-809.3,657.3-1465.3,1468.1-1465.3C17592.7-1163.5,18250-507.3,18250,302z" />
    </svg>
  );
}

function Topbar() {
  return (
    <div className="topbar">
      <div className="brand"><div className="logo"><Logo /></div></div>
      <span className="navlabel">WordPress SEO Studio</span>
    </div>
  );
}

function auditField(val, min, max, name) {
  const v = (val || "").trim(), n = v.length;
  if (!n) return { state: "missing", msg: `${name} missing` };
  if (n > max) return { state: "long", msg: `${name} too long (${n}/${max})` };
  if (n < min) return { state: "short", msg: `${name} too short (${n}/${min}+)` };
  return { state: "ok", msg: `${name} OK (${n})` };
}
function auditItem(item) {
  const title = auditField(item.curTitle, TITLE_MIN, TITLE_MAX, "Meta title");
  const desc = auditField(item.curDesc, DESC_MIN, DESC_MAX, "Meta description");
  return { title, desc, hasIssue: title.state !== "ok" || desc.state !== "ok" };
}
function counterClass(len, min, max) {
  return len >= min && len <= max ? "ok" : "warn";
}

// --- Search ---------------------------------------------------------------
// Matches on title, slug/handle and full URL. Multiple words = AND (all must
// appear somewhere), so "blue shirt" finds "Blue Linen Shirt".
function matchesQuery(item, q) {
  if (!q) return true;
  const hay = [item.title, item.handle, item.link, item.blogTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export default function Page() {
  const [data, setData] = useState({ pages: [], posts: [], postCategories: [], products: [], productCategories: [] });
  const [site, setSite] = useState({ name: "", seo: "none", woocommerce: false });
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState("pages");
  const [connected, setConnected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [busyAll, setBusyAll] = useState(false);
  const [page, setPage] = useState(1);
  const [queries, setQueries] = useState({}); // search text, kept per tab

  // connect form
  const [fSite, setFSite] = useState("");
  const [fUser, setFUser] = useState("");
  const [fPass, setFPass] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(window.__t);
    window.__t = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const buildTabs = useCallback((woo) => {
    const t = ALL_TABS.filter((x) => !x.woo || woo);
    setTabs(t);
    setActiveTab((cur) => (t.some((x) => x.key === cur) ? cur : t[0].key));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/items");
      if (res.status === 401) {
        setConnected(false);
        setLoading(false);
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load");
      const dec = (arr) => (arr || []).map((it) => ({ ...it, genTitle: "", genDesc: "", status: "idle", error: "" }));
      setData({
        pages: dec(d.pages),
        posts: dec(d.posts),
        postCategories: dec(d.postCategories),
        products: dec(d.products),
        productCategories: dec(d.productCategories),
      });
      setSite(d.site || { name: "", seo: "none", woocommerce: false });
      buildTabs(d.site && d.site.woocommerce);
      setConnected(true);
    } catch (e) {
      setConnected(true);
      setLoadError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [buildTabs]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    if (!fSite.trim() || !fUser.trim() || !fPass.trim()) {
      setConnectError("Please fill in all three fields.");
      return;
    }
    setConnecting(true);
    setConnectError("");
    try {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: fSite, username: fUser, password: fPass }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not connect.");
      await load();
    } catch (e) {
      setConnectError(e.message || String(e));
    } finally {
      setConnecting(false);
    }
  }, [fSite, fUser, fPass, load]);

  const patchItem = useCallback((type, id, patch) => {
    setData((prev) => ({
      ...prev,
      [type]: prev[type].map((it) =>
        it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it
      ),
    }));
  }, []);

  const generate = useCallback(
    async (item) => {
      patchItem(item.type, item.id, { status: "working", error: "" });
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: item.type, title: item.title, handle: item.handle, context: item.context, store: site.name }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Generation failed");
        patchItem(item.type, item.id, { genTitle: d.metaTitle || "", genDesc: d.metaDescription || "", status: "ready", error: "" });
        return true;
      } catch (e) {
        patchItem(item.type, item.id, { status: "error", error: e.message || String(e) });
        return false;
      }
    },
    [patchItem, site.name]
  );

  const importItem = useCallback(
    async (item) => {
      if (!item.genTitle) { showToast("Generate a suggestion first."); return false; }
      patchItem(item.type, item.id, { status: "working", error: "" });
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: item.type, id: item.id, metaTitle: item.genTitle, metaDescription: item.genDesc }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Import failed");
        patchItem(item.type, item.id, { status: "imported", curTitle: item.genTitle, curDesc: item.genDesc, error: "" });
        return true;
      } catch (e) {
        patchItem(item.type, item.id, { status: "error", error: e.message || String(e) });
        return false;
      }
    },
    [patchItem, showToast]
  );

  const allItems = data[activeTab] || [];
  const query = queries[activeTab] || "";
  const deferredQuery = useDeferredValue(query);

  const setQuery = useCallback((v) => {
    setQueries((prev) => ({ ...prev, [activeTab]: v }));
    setPage(1);
  }, [activeTab]);

  // Everything below (bulk actions, counts, pager) works off the FILTERED list,
  // so "Generate all" / "Import all" act on what the user can actually see.
  const items = useMemo(
    () => (deferredQuery ? allItems.filter((i) => matchesQuery(i, deferredQuery)) : allItems),
    [allItems, deferredQuery]
  );

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const fixIssues = useCallback(async () => {
    const list = items.filter((i) => auditItem(i).hasIssue && (i.status === "idle" || i.status === "error"));
    if (!list.length) { showToast("No SEO issues to fix on this tab."); return; }
    setBusyAll(true);
    for (const it of list) await generate(it);
    setBusyAll(false);
    showToast(`Drafted fixes for ${list.length} item${list.length > 1 ? "s" : ""}. Review & import.`);
  }, [items, generate, showToast]);

  const generateAll = useCallback(async () => {
    const list = items.filter((i) => i.status === "idle" || i.status === "error");
    if (!list.length) { showToast("Nothing left to generate on this tab."); return; }
    setBusyAll(true);
    for (const it of list) await generate(it);
    setBusyAll(false);
    showToast(`Generated ${list.length} suggestion${list.length > 1 ? "s" : ""}.`);
  }, [items, generate, showToast]);

  const importAll = useCallback(async () => {
    const list = items.filter((i) => i.status === "ready");
    if (!list.length) { showToast("No reviewed suggestions ready to import."); return; }
    setBusyAll(true);
    let ok = 0;
    for (const it of list) if (await importItem(it)) ok++;
    setBusyAll(false);
    showToast(`Imported ${ok} of ${list.length} to WordPress.`);
  }, [items, importItem, showToast]);

  const counts = useMemo(() => {
    const ready = items.filter((i) => i.status === "ready").length;
    const pending = items.filter((i) => i.status === "idle" || i.status === "error").length;
    const issues = items.filter((i) => auditItem(i).hasIssue && (i.status === "idle" || i.status === "error")).length;
    const withIssues = items.filter((i) => auditItem(i).hasIssue).length;
    return { ready, pending, issues, withIssues };
  }, [items]);

  const activeLabel = (tabs.find((t) => t.key === activeTab) || { label: "items" }).label.toLowerCase();

  // ---- Connect screen ----
  if (connected === false) {
    return (
      <>
        <Topbar />
        <div className="gate">
          <span className="badge">WordPress SEO</span>
          <h2>Connect your WordPress site</h2>
          <p>Enter your site URL and a WordPress <b>Application Password</b> (Users → Profile → Application Passwords). The companion plugin must be installed.</p>
          {connectError && <div className="gate-error">⚠ {connectError}</div>}
          <input type="text" value={fSite} placeholder="https://yoursite.com" onChange={(e) => setFSite(e.target.value)} />
          <input type="text" value={fUser} placeholder="WordPress username" onChange={(e) => setFUser(e.target.value)} />
          <input type="password" value={fPass} placeholder="Application password (xxxx xxxx xxxx xxxx)" onChange={(e) => setFPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
          <button className="btn primary" style={{ width: "100%" }} onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect site ▸"}
          </button>
          <p className="gate-hint">Your credentials are stored only in an encrypted, http-only cookie — never exposed to the browser.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar />
      <div className="wrap">
        <div className="panel">
          <div className="intro">
            <span className="badge">WordPress SEO</span>
            <div className="intro-top">
              <div>
                <h1>Where does your site sit on SEO?</h1>
                <p>
                  Generate Google best-practice meta titles &amp; descriptions for your WordPress posts,
                  pages, categories{site.woocommerce ? " and WooCommerce products" : ""}. Review, edit, then import straight to your site.
                </p>
              </div>
              <div className="store-box">
                <div className="store-chip">
                  <span className="dotg" style={{ background: site.name ? "#BFFC00" : "#9aa1ad" }} />
                  {site.name ? <b>{site.name}</b> : "Connected"}
                </div>
                <a className="btn ghost sm" href="/api/auth/logout">⇄ Disconnect site</a>
              </div>
            </div>
          </div>

          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.key} className={"tab" + (t.key === activeTab ? " active" : "")} onClick={() => { setActiveTab(t.key); setPage(1); }}>
                {t.label} <span className="count">{(data[t.key] || []).length}</span>
              </button>
            ))}
          </div>

          {!loading && !loadError && allItems.length > 0 && (
            <div className="searchbar">
              <div className="search-input">
                <span className="ico">⌕</span>
                <input
                  type="search"
                  value={query}
                  placeholder={`Search ${activeLabel} by title or URL…`}
                  aria-label={`Search ${activeLabel} by title or URL`}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                />
                {query && (
                  <button className="clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>
                )}
              </div>
              {query && (
                <span className="search-count">
                  <b>{items.length}</b> of {allItems.length} match
                </span>
              )}
            </div>
          )}

          {!loading && !loadError && items.length > 0 && (
            <div className="toolbar">
              <button className="btn primary" onClick={fixIssues} disabled={busyAll || !counts.issues}>
                ⚡ Fix issues{counts.issues ? ` (${counts.issues})` : ""}
              </button>
              <button className="btn" onClick={generateAll} disabled={busyAll || !counts.pending}>
                Generate all{counts.pending ? ` (${counts.pending})` : ""}
              </button>
              <div className="spacer" />
              <button className="btn dark" onClick={importAll} disabled={busyAll || !counts.ready}>
                Import all ready{counts.ready ? ` (${counts.ready})` : ""} ▸
              </button>
            </div>
          )}

          {!loading && !loadError && items.length > 0 && (
            <div className={"summary " + (counts.withIssues ? "issues" : "clean")}>
              {counts.withIssues ? "⚠ " : "✓ "}
              <span>
                {counts.withIssues ? (
                  <><b>{counts.withIssues}</b> of {items.length} {activeLabel} have SEO meta issues to fix.</>
                ) : (
                  <>All {items.length} {activeLabel} have healthy meta titles &amp; descriptions.</>
                )}
              </span>
            </div>
          )}

          {loading && (
            <div className="loading">
              <div>Loading your site content</div>
              <div style={{ marginTop: 10 }}><span className="dot" /><span className="dot" /><span className="dot" /></div>
            </div>
          )}

          {loadError && (
            <div className="empty">
              Couldn&apos;t load site content.<br />
              <small>{loadError}</small>
              <div style={{ marginTop: 14 }}><button className="btn" onClick={load}>Retry</button></div>
            </div>
          )}

          {!loading && !loadError && items.length === 0 && (
            <div className="empty">
              {query ? (
                <>
                  No {activeLabel} match &ldquo;{query}&rdquo;.
                  <div style={{ marginTop: 14 }}>
                    <button className="btn ghost sm" onClick={() => setQuery("")}>Clear search</button>
                  </div>
                </>
              ) : (
                <>No {activeLabel} found on this site.</>
              )}
            </div>
          )}

          {!loading && !loadError &&
            pageItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onGenerate={() => generate(item)}
                onImport={() => importItem(item)}
                onEdit={(field, value) => patchItem(item.type, item.id, { [field]: value })}
              />
            ))}

          {!loading && !loadError && totalPages > 1 && (
            <div className="pager">
              <button className="btn ghost sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
              <span className="pginfo">Page {safePage} of {totalPages} · {items.length} total</span>
              <button className="btn ghost sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next ›</button>
            </div>
          )}

          <div className="foot">Boko Digital · Strategize. Execute. Deliver. — meta written clear, concise, active voice.</div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function ItemCard({ item, onGenerate, onImport, onEdit }) {
  const a = auditItem(item);
  const tLen = (item.genTitle || "").length;
  const dLen = (item.genDesc || "").length;
  const showFields = item.status === "ready" || item.status === "imported" || (item.status === "working" && item.genTitle);

  const stMap = {
    idle: ["st-idle", "Not generated"],
    working: ["st-working", "Working…"],
    ready: ["st-ready", "Ready to review"],
    imported: ["st-imported", "Imported ✓"],
    error: ["st-error", "Error"],
  };
  const st = stMap[item.status] || stMap.idle;

  let idleLabel = "⚡ Generate";
  if (item.curTitle || item.curDesc) idleLabel = a.hasIssue ? "⚡ Fix meta" : "⚡ Suggest improvement";

  const chip = (o) => (
    <span className={"audit-chip " + (o.state === "ok" ? "good" : "bad")}>
      {o.state === "ok" ? "✓" : "⚠"} {o.msg}
    </span>
  );

  return (
    <div className={"card" + (item.status === "imported" ? " imported" : "")}>
      <div className="card-head">
        <div>
          <p className="card-title">{item.title}</p>
          <div className="card-handle">/{item.handle}</div>
        </div>
        <span className={"status-pill " + st[0]}>{st[1]}</span>
      </div>

      <div className="audit">{chip(a.title)}{chip(a.desc)}</div>

      {item.curTitle || item.curDesc ? (
        <div className="current">
          <b>Current meta title:</b> {item.curTitle || <i>none</i>}<br />
          <b>Current meta description:</b> {item.curDesc || <i>none</i>}
        </div>
      ) : (
        <div className="current">No meta title or description set yet.</div>
      )}

      {showFields && (
        <>
          <div className="field">
            <label>Meta title <span className={"counter " + counterClass(tLen, TITLE_MIN, TITLE_MAX)}>{tLen} / {TITLE_MAX}</span></label>
            <textarea className="title" value={item.genTitle} onChange={(e) => onEdit("genTitle", e.target.value)} />
          </div>
          <div className="field">
            <label>Meta description <span className={"counter " + counterClass(dLen, DESC_MIN, DESC_MAX)}>{dLen} / {DESC_MAX}</span></label>
            <textarea className="desc" value={item.genDesc} onChange={(e) => onEdit("genDesc", e.target.value)} />
          </div>
        </>
      )}

      {item.status === "error" && item.error && <div className="err">⚠ {item.error}</div>}

      <div className="card-actions">
        {item.status === "idle" && <button className="btn primary sm" onClick={onGenerate}>{idleLabel}</button>}
        {item.status === "ready" && (
          <>
            <button className="btn dark sm" onClick={onImport}>Import ▸</button>
            <button className="btn ghost sm" onClick={onGenerate}>↻ Regenerate</button>
          </>
        )}
        {item.status === "imported" && (
          <>
            <button className="btn ghost sm" onClick={onGenerate}>↻ Regenerate</button>
            <button className="btn dark sm" onClick={onImport}>Re-import ▸</button>
          </>
        )}
        {item.status === "error" && (
          <>
            <button className="btn primary sm" onClick={onGenerate}>↻ Try again</button>
            {item.genTitle && <button className="btn dark sm" onClick={onImport}>Import ▸</button>}
          </>
        )}
        {item.status === "working" && <button className="btn sm" disabled>Working…</button>}
      </div>
    </div>
  );
}
