"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Posts to /api/generate, then refreshes the server component so the new row
 *  and the updated quota both come from one source of truth. */
export default function ItemForm({ outOfRuns }: { outOfRuns: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: data.get("title"), input: data.get("input") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Something went wrong.");

      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="font-medium">New run</h2>

      <label className="mt-4 flex flex-col gap-1.5 text-sm">
        Title
        <input
          name="title"
          required
          placeholder="Give it a name"
          className="rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus:border-accent"
        />
      </label>

      <label className="mt-4 flex flex-col gap-1.5 text-sm">
        Input
        <textarea
          name="input"
          required
          rows={4}
          placeholder="Whatever the model should work from"
          className="resize-y rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus:border-accent"
        />
      </label>

      <button
        disabled={pending || outOfRuns}
        className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {outOfRuns ? "Out of free runs" : pending ? "Working…" : "Generate"}
      </button>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </form>
  );
}
