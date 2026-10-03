import styles from '@/app/(delegate)/delegate.module.css';
import type { TaskSnapshot } from '@/lib/frontend/delegate/model';
import { SilverFrame } from './effects';

type ResultPanelProps = { snapshot: TaskSnapshot; paused?: boolean };

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function ResultPanel({ snapshot, paused = false }: ResultPanelProps) {
  const { task } = snapshot;
  const result = task.status === 'closed' ? task.result : undefined;

  if (!result) {
    const closed = task.status === 'closed';
    return (
      <section className={styles.resultPanel} aria-labelledby="result-title">
        <p className={styles.resultEyebrow}>{closed ? 'TASK CLOSED' : task.status === 'closing' ? 'CLOSING' : 'RESULT'}</p>
        <h2 className={styles.resultTitle} id="result-title">
          {closed ? 'Task closed · result unavailable' : task.status === 'closing' ? 'Result not published yet' : 'Awaiting task closure'}
        </h2>
        {!closed ? <p className={styles.resultSummary}>A final result appears here when the task is closed.</p> : null}
      </section>
    );
  }

  const tally = task.response_type === 'choice' ? result.tally : undefined;
  const votes = tally ? Object.entries(tally) : [];
  const totalVotes = votes.reduce((total, [, count]) => total + count, 0);
  const verified = result.responses.length;

  return (
    <section className={styles.resultPanel} aria-labelledby="result-title">
      <SilverFrame paused={paused}>
        <p className={styles.resultEyebrow}>RESULT READY</p>
      </SilverFrame>
      <p className={styles.resultDeck}>Human inference complete</p>
      <h2 className={styles.resultTitle} id="result-title">
        {result.winner.trim() || 'No verified human signals'}
      </h2>
      {result.summary ? <p className={styles.resultSummary}>{result.summary}</p> : null}

      {votes.length ? (
        <div className={styles.tally} aria-label="Choice tally">
          {votes.map(([option, count]) => (
            <div className={styles.tallyRow} key={option}>
              <span className={styles.tallyLabel}>{option}</span>
              <span className={styles.tallyTrack} aria-hidden="true">
                <span
                  className={styles.tallyBar}
                  style={{ width: `${totalVotes ? (count / totalVotes) * 100 : 0}%` }}
                />
              </span>
              <span className={styles.tallyCount}>{count}</span>
            </div>
          ))}
          <p className={styles.tallyCaption}>Votes among verified signals</p>
        </div>
      ) : null}

      {verified > 0 ? (
        <div className={styles.paymentReport}>
          <p className={styles.payoutTotal}>REPORTED PAYOUT · {formatUsd(result.paid.total_cents)}</p>
          <p className={styles.payoutPerHuman}>{formatUsd(result.paid.per_human_cents)} per verified signal</p>
          <p className={styles.settlementNote}>
            {result.paid.stripe
              ? 'Stripe PaymentIntent recorded · settlement unconfirmed'
              : 'Stripe settlement unavailable'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
