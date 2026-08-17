"use client";

/**
 * Shown to a paying member who has connected a site their plan doesn't cover.
 *
 * They aren't locked out — the free item allowance still applies here — but
 * they need to know why a plan they're paying for isn't unlocking this site,
 * and which site it is unlocking instead.
 */
export default function SiteNotice({ notice, upgradeUrl }) {
  if (!notice) return null;

  const limit = Number(notice.limit) || 1;
  const covered = (notice.coveredSites || []).filter(Boolean);
  const plan = notice.planLabel && notice.planLabel !== "Free" ? `${notice.planLabel} plan` : "plan";

  return (
    <div className="site-notice">
      <div className="site-notice-copy">
        <b>
          {notice.site} isn&apos;t on your {plan}.
        </b>{" "}
        Your {plan} covers {limit === 1 ? "one site" : `${limit} sites`}
        {covered.length > 0 && (
          <>
            {" "}
            — {limit === 1 ? "currently" : "currently"}{" "}
            {covered.map((s, i) => (
              <span key={s}>
                {i > 0 && (i === covered.length - 1 ? " and " : ", ")}
                <code>{s}</code>
              </span>
            ))}
          </>
        )}
        . You can still use the free allowance here. If you&apos;ve moved to this site, contact
        Boko and we&apos;ll switch your plan across.
      </div>
      <div className="site-notice-actions">
        <a className="btn primary sm" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
          Add a site to my plan ▸
        </a>
      </div>
    </div>
  );
}
