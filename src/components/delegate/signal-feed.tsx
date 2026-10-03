import styles from '@/app/(delegate)/delegate.module.css';
import { signalCounts, signalIdentityKeys, type TaskSnapshot } from '@/lib/frontend/delegate/model';
import { ArrivalBeam } from './effects';

type SignalFeedProps = {
  snapshot: TaskSnapshot;
  arrivingIds: ReadonlySet<string>;
  detailsFailed: boolean;
  paused: boolean;
};

export default function SignalFeed({ snapshot, arrivingIds, detailsFailed, paused }: SignalFeedProps) {


  const { task, signals } = snapshot;
  const result = task.status === 'closed' ? task.result : undefined;
  const counts = signalCounts(snapshot);
  const detailsUnavailable = !counts || (!result && task.responses_count > 0 && signals.length === 0);
  const identityKeys = signalIdentityKeys(signals);

  return (
    <section className={styles.signalPanel} aria-labelledby="signal-title">
      <header className={styles.signalHeader}>
        <div>
          <h2 className={styles.signalEyebrow} id="signal-title">HUMAN SIGNALS</h2>
          <p className={styles.signalCount} role="status" aria-live="polite">
            {new Intl.NumberFormat('en-US').format(task.responses_count)} HUMAN SIGNALS RECEIVED
          </p>
        </div>
        {detailsUnavailable ? (
          <p className={styles.signalBreakdownUnavailable}>
            {snapshot.signalsLoaded
              ? 'Signal details unavailable'
              : signals.length > 0
                ? 'Signal details unavailable · showing last known signals'
                : detailsFailed
                  ? 'Signal details unavailable'
                  : 'Loading signal details'}
          </p>
        ) : (
          <p className={styles.signalBreakdown}>
            {counts.verified} verified · {counts.screening} screening · {counts.rejected} rejected
          </p>
        )}
      </header>

      {signals.length ? (
        <ol className={styles.signalList} aria-label="Human responses">
          {signals.map((signal, index) => {
            const identity = identityKeys[index] ?? signal.id;
            const rejected = signal.status === 'rejected';
            const statusLabel = rejected ? 'REJECTED' : signal.status === 'accepted' ? 'VERIFIED' : 'SCREENING';
            return (
              <li
                className={styles.signalRow}
                key={signal.id}
                data-arriving={arrivingIds.has(identity) ? 'true' : undefined}
              >
                <ArrivalBeam active={!paused && arrivingIds.has(identity)}>
                  <div className={styles.signalContent}>
                    <p className={`${styles.signalAnswer} ${rejected ? styles.signalAnswerRejected : ''}`}>
                      {signal.answer}
                    </p>
                    <div className={styles.signalMetadata}>
                      <span>{signal.name}</span>
                      <span className={styles.signalStatus} data-status={signal.status}>{statusLabel}</span>
                      {rejected && signal.reason ? <span className={styles.signalReason}>{signal.reason}</span> : null}
                    </div>
                  </div>
                </ArrivalBeam>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.signalEmpty} role="status">
          {task.responses_count > 0 ? 'Signal details are unavailable.' : 'No human signals received yet.'}
        </p>
      )}
    </section>
  );
}
