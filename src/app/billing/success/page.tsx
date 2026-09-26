import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re on Pro</h1>
      <p className="mt-3 text-sm text-muted">
        Unlimited drafts. If the dashboard still shows the free plan, give the Stripe
        webhook a few seconds and reload.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 rounded-lg bg-accent px-5 py-3 font-medium text-white transition hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
