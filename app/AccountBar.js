"use client";

// Boko membership status: sign in with the boko.com.au account, see the current
// plan, sign out. Ships identically in both apps.

import { useCallback, useEffect, useState } from "react";

const SIGNIN_MESSAGES = {
  ok: "",
  state: "Sign-in didn't complete — please try again.",
  notoken: "Sign-in didn't complete — no token came back from boko.com.au.",
  invalid: "That sign-in link wasn't valid. Try signing in again.",
};

export default function AccountBar({ onChange }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account");
      const d = await res.json();
      setAccount(d);
      if (onChange) onChange(d);
    } catch (e) {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    // Surface the result of a sign-in round trip, then tidy the URL.
    try {
      const params = new URLSearchParams(window.location.search);
      const signin = params.get("signin");
      if (signin !== null) {
        setNotice(SIGNIN_MESSAGES[signin] ?? "Sign-in didn't complete.");
        params.delete("signin");
        const q = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
      }
    } catch (e) {
      /* non-browser or blocked history API — not worth failing over */
    }
    load();
  }, [load]);

  const signOut = useCallback(async () => {
    await fetch("/api/account", { method: "DELETE" });
    await load();
  }, [load]);

  if (loading || !account || !account.ssoAvailable) return null;

  return (
    <>
      {account.signedIn ? (
        <div className="acct">
          <span className={"plan-chip plan-" + (account.plan || "free")}>{account.planLabel}</span>
          <span className="acct-email" title={account.email}>{account.email}</span>
          <button className="acct-link" onClick={signOut}>Sign out</button>
        </div>
      ) : (
        <a className="btn dark sm" href="/api/auth/boko">Sign in with Boko ▸</a>
      )}
      {notice && <div className="acct-notice">⚠ {notice}</div>}
    </>
  );
}
