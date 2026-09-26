"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 text-xs text-muted transition hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function ItemList({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-muted">
        Nothing yet. Your results will show up here.
      </p>
    );
  }

  return (
    <section className="mt-10 flex flex-col gap-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Recent</h2>

      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{item.title}</p>
            <time className="text-xs text-muted">
              {new Date(item.created_at).toLocaleDateString()}
            </time>
          </div>

          {item.output && (
            <>
              <p className="mt-2 text-sm text-muted">{item.output.summary}</p>

              {item.output.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.output.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 rounded-lg bg-background p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-muted">Result</span>
                  <CopyButton text={item.output.result} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {item.output.result}
                </p>
              </div>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
