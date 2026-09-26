"use client";

import { useState } from "react";

export default function UpgradeButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Checkout failed.");
      window.location.href = body.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
      setPending(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={upgrade}
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Opening Stripe…" : "Upgrade to Pro"}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
