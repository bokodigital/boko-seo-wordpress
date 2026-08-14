"use client";

// Alt tags tab — finds images with no alt text, suggests one for each, lets the
// user edit it and writes it back.
//
// The same file ships in both the Shopify and WordPress apps; `platform` is the
// only difference (how a page of images is requested, and what a save posts).

import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ALT_MAX, auditAlt, altCounterClass } from "@/lib/seo-audit";

const PAGE_SIZE = 12;

function matchesQuery(img, q) {
  if (!q) return true;
  const hay = [img.ownerTitle, img.filename, img.ownerLabel, img.alt]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export default function AltTagsPanel({ platform, upgradeUrl, onToast }) {
  const isShopify = platform === "shopify";
  const target = isShopify ? "Shopify" : "WordPress";

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [needsPluginUpdate, setNeedsPluginUpdate] = useState(false);
  const [gate, setGate] = useState(null);
  const [next, setNext] = useState(null); // cursor (Shopify) or offset (WP)
  const [total, setTotal] = useState(null); // WP only: total missing alt on the site
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busyAll, setBusyAll] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseErr, setLicenseErr] = useState("");
  const loadedOnce = useRef(false);

  const deferredQuery = useDeferredValue(query);

  const toast = useCallback((m) => { if (onToast) onToast(m); }, [onToast]);

  const fetchPage = useCallback(
    async (cursorOrOffset, loadedCount) => {
      const params = new URLSearchParams();
      if (cursorOrOffset !== null && cursorOrOffset !== undefined) {
        params.set(isShopify ? "cursor" : "offset", String(cursorOrOffset));
      }
      params.set("loaded", String(loadedCount || 0));
      const res = await fetch(`/api/images?${params.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(d.error || "Couldn't scan your images.");
        err.needsPluginUpdate = !!d.needsPluginUpdate;
        throw err;
      }
      return d;
    },
    [isShopify]
  );

  const decorate = useCallback(
    (arr) =>
      (arr || []).map((im) => ({
        ...im,
        alt: im.suggested || "",
        status: "idle",
        error: "",
      })),
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNeedsPluginUpdate(false);
    try {
      const d = await fetchPage(null, 0);
      setImages(decorate(d.images));
      setGate(d.gate || null);
      setNext(isShopify ? d.nextCursor || null : d.nextOffset ?? null);
      setTotal(typeof d.total === "number" ? d.total : null);
    } catch (e) {
      setError(e.message || String(e));
      setNeedsPluginUpdate(!!e.needsPluginUpdate);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, decorate, isShopify]);

  const loadMore = useCallback(async () => {
    if (next === null || next === undefined) return;
    setLoadingMore(true);
    setError("");
    try {
      const d = await fetchPage(next, images.length);
      setImages((prev) => [...prev, ...decorate(d.images)]);
      setGate(d.gate || null);
      setNext(isShopify ? d.nextCursor || null : d.nextOffset ?? null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [next, images.length, fetchPage, decorate, isShopify]);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    load();
  }, [load]);

  const patch = useCallback((key, p) => {
    setImages((prev) => prev.map((im) => (im.key === key ? { ...im, ...p } : im)));
  }, []);

  const save = useCallback(
    async (img) => {
      if (img.locked) {
        toast("Upgrade with Boko to fix this image.");
        return false;
      }
      const alt = (img.alt || "").trim();
      if (!alt) {
        toast("Write some alt text first.");
        return false;
      }
      patch(img.key, { status: "saving", error: "" });
      try {
        const payload = isShopify
          ? {
              kind: img.kind,
              ownerId: img.ownerId,
              mediaId: img.mediaId,
              imageId: img.imageId,
              alt,
              locked: img.locked,
            }
          : { id: img.id, alt, locked: img.locked };
        const res = await fetch("/api/alt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Save failed");
        patch(img.key, { status: "saved", alt: d.alt || alt, error: "" });
        return true;
      } catch (e) {
        patch(img.key, { status: "error", error: e.message || String(e) });
        return false;
      }
    },
    [patch, isShopify, toast]
  );

  const filtered = useMemo(
    () => (deferredQuery ? images.filter((i) => matchesQuery(i, deferredQuery)) : images),
    [images, deferredQuery]
  );

  const counts = useMemo(() => {
    const saved = filtered.filter((i) => i.status === "saved").length;
    const ready = filtered.filter(
      (i) => !i.locked && i.status !== "saved" && (i.alt || "").trim()
    ).length;
    const manual = filtered.filter((i) => i.needsManual && i.status !== "saved").length;
    return { saved, ready, manual };
  }, [filtered]);

  const saveAll = useCallback(async () => {
    const list = filtered.filter(
      (i) => !i.locked && i.status !== "saved" && (i.alt || "").trim()
    );
    if (!list.length) {
      toast("Nothing ready to save on this tab.");
      return;
    }
    setBusyAll(true);
    let ok = 0;
    for (const im of list) if (await save(im)) ok++;
    setBusyAll(false);
    toast(`Saved alt text on ${ok} of ${list.length} image${list.length > 1 ? "s" : ""}.`);
  }, [filtered, save, toast]);

  const resetAll = useCallback(() => {
    setImages((prev) =>
      prev.map((im) => (im.status === "saved" ? im : { ...im, alt: im.suggested || "", status: "idle", error: "" }))
    );
    toast("Reset every suggestion on this tab.");
  }, [toast]);

  // Same licence flow as the meta tabs — a merchant who hits the image limit
  // shouldn't have to go hunting for another tab to unlock.
  const activateLicense = useCallback(async () => {
    const key = licenseKey.trim();
    if (!key) return;
    setLicenseErr("");
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.active) throw new Error(d.error || "Invalid licence key.");
      setLicenseKey("");
      toast("Membership activated — everything unlocked.");
      loadedOnce.current = false;
      await load();
      loadedOnce.current = true;
    } catch (e) {
      setLicenseErr(e.message || String(e));
    }
  }, [licenseKey, load, toast]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return (
      <div className="loading">
        <div>Scanning your images for missing alt text</div>
        <div style={{ marginTop: 10 }}><span className="dot" /><span className="dot" /><span className="dot" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty">
        {needsPluginUpdate ? "Bridge plugin update needed." : "Couldn't scan your images."}
        <br />
        <small>{error}</small>
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {gate && gate.member && (
        <div className="member-banner">✓ Membership active — every image is unlocked.</div>
      )}
      {gate && gate.locked && (
        <div className="upgrade-banner">
          <div className="upgrade-copy">
            <b>You&apos;re on the free plan.</b> The first {gate.freeLimit} images are free to fix.{" "}
            {gate.lockedCount} more {gate.lockedCount === 1 ? "image is" : "images are"} locked.
          </div>
          <div className="upgrade-actions">
            <a className="btn primary sm" href={gate.upgradeUrl || upgradeUrl} target="_blank" rel="noopener noreferrer">
              Upgrade with Boko ▸
            </a>
            <div className="license-form">
              <input
                type="text"
                value={licenseKey}
                placeholder="Already purchased? Paste licence key"
                aria-label="Licence key"
                onChange={(e) => setLicenseKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") activateLicense(); }}
              />
              <button className="btn dark sm" onClick={activateLicense}>Unlock</button>
            </div>
          </div>
          {licenseErr && <div className="license-err">⚠ {licenseErr}</div>}
        </div>
      )}

      {images.length > 0 && (
        <div className="searchbar">
          <div className="search-input">
            <span className="ico">⌕</span>
            <input
              type="search"
              value={query}
              placeholder="Search images by product, filename or alt text…"
              aria-label="Search images"
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            />
            {query && (
              <button className="clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>
            )}
          </div>
          {query && (
            <span className="search-count"><b>{filtered.length}</b> of {images.length} match</span>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="toolbar">
          <button className="btn primary" onClick={saveAll} disabled={busyAll || !counts.ready}>
            ⚡ Save all suggestions{counts.ready ? ` (${counts.ready})` : ""}
          </button>
          <button className="btn ghost" onClick={resetAll} disabled={busyAll}>↻ Reset edits</button>
          <div className="spacer" />
          {counts.saved > 0 && <span className="search-count"><b>{counts.saved}</b> saved</span>}
        </div>
      )}

      {images.length > 0 && (
        <div className={"summary " + (filtered.length - counts.saved > 0 ? "issues" : "clean")}>
          {filtered.length - counts.saved > 0 ? "⚠ " : "✓ "}
          <span>
            {filtered.length - counts.saved > 0 ? (
              <>
                <b>{filtered.length - counts.saved}</b> image
                {filtered.length - counts.saved === 1 ? "" : "s"} still missing alt text
                {typeof total === "number" && total > images.length ? ` (${total} found site-wide)` : ""}.
                {counts.manual > 0 && ` ${counts.manual} need${counts.manual === 1 ? "s" : ""} a human description.`}
              </>
            ) : (
              <>Every image scanned now has alt text. Nice work.</>
            )}
          </span>
        </div>
      )}

      {images.length === 0 && (
        <div className="empty">
          {query ? (
            <>No images match &ldquo;{query}&rdquo;.</>
          ) : (
            <>
              ✓ No images are missing alt text.
              <br />
              <small>Every image we scanned already has a description.</small>
            </>
          )}
        </div>
      )}

      {pageItems.map((img) => (
        <ImageCard
          key={img.key}
          img={img}
          target={target}
          upgradeUrl={(gate && gate.upgradeUrl) || upgradeUrl}
          onEdit={(v) => patch(img.key, { alt: v, status: img.status === "saved" ? "idle" : img.status })}
          onReset={() => patch(img.key, { alt: img.suggested || "", status: "idle", error: "" })}
          onSave={() => save(img)}
        />
      ))}

      {totalPages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
          <span className="pginfo">Page {safePage} of {totalPages} · {filtered.length} total</span>
          <button className="btn ghost sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next ›</button>
        </div>
      )}

      {next !== null && next !== undefined && (
        <div className="scanmore">
          <button className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Scanning…" : "Scan more images"}
          </button>
          <div className="scanmore-note">
            Large catalogues are scanned in batches so the connection doesn&apos;t time out.
          </div>
        </div>
      )}
    </>
  );
}

function ImageCard({ img, target, upgradeUrl, onEdit, onReset, onSave }) {
  const alt = img.alt || "";
  const a = auditAlt(alt);
  const over = alt.length > ALT_MAX;

  const stMap = {
    idle: ["st-idle", "Missing alt"],
    saving: ["st-working", "Saving…"],
    saved: ["st-imported", "Saved ✓"],
    error: ["st-error", "Error"],
  };
  const st = stMap[img.status] || stMap.idle;

  if (img.locked) {
    return (
      <div className="imgcard locked">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="imgthumb" src={img.thumb || img.url} alt="" loading="lazy" />
        <div className="imgbody">
          <div className="card-head">
            <div>
              <p className="card-title">{img.ownerTitle}</p>
              <div className="card-handle">{img.ownerLabel}{img.filename ? ` · ${img.filename}` : ""}</div>
            </div>
            <span className="status-pill st-locked">🔒 Locked</span>
          </div>
          <div className="lock-note">
            On the free plan only your first 10 images can be fixed. Upgrade with Boko to unlock this one.
          </div>
          <div className="card-actions">
            <a className="btn primary sm" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
              🔒 Upgrade to fix
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"imgcard" + (img.status === "saved" ? " saved" : "")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="imgthumb" src={img.thumb || img.url} alt="" loading="lazy" />
      <div className="imgbody">
        <div className="card-head">
          <div>
            <p className="card-title">{img.ownerTitle}</p>
            <div className="card-handle">
              {img.ownerLabel}
              {img.index > 0 ? ` · image ${img.index + 1}` : ""}
              {img.filename ? ` · ${img.filename}` : ""}
            </div>
          </div>
          <span className={"status-pill " + st[0]}>{st[1]}</span>
        </div>

        {img.needsManual && img.status !== "saved" && (
          <div className="lock-note">
            Nothing in the filename or the title to work from — please describe this image yourself.
          </div>
        )}

        <div className="field">
          <label>
            Alt text
            <span className={"counter " + altCounterClass(alt)}>
              {alt.length} / {ALT_MAX}
            </span>
          </label>
          <textarea
            className="title"
            value={alt}
            placeholder="Describe what's in the image, for screen readers and search engines."
            aria-label={`Alt text for ${img.ownerTitle}`}
            onChange={(e) => onEdit(e.target.value)}
          />
        </div>

        <div className="audit">
          <span className={"audit-chip " + (a.ok ? "good" : "bad")}>
            {a.ok ? "✓" : "⚠"} {a.msg}
          </span>
        </div>

        {img.status === "error" && img.error && <div className="err">⚠ {img.error}</div>}

        <div className="card-actions">
          {img.status === "saving" ? (
            <button className="btn sm" disabled>Saving…</button>
          ) : (
            <button className="btn dark sm" onClick={onSave} disabled={!alt.trim() || over}>
              {img.status === "saved" ? "Save again ▸" : `Save to ${target} ▸`}
            </button>
          )}
          {img.suggested && alt !== img.suggested && (
            <button className="btn ghost sm" onClick={onReset}>↻ Reset to suggestion</button>
          )}
          {img.url && (
            <a className="btn ghost sm" href={img.url} target="_blank" rel="noopener noreferrer">View image ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}
