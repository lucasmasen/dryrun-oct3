import styles from '@/app/(delegate)/delegate.module.css';

export type ExecutionEvent = { id: string; label: string };

type ExecutionStreamProps = { events: ExecutionEvent[] };

export default function ExecutionStream({ events }: ExecutionStreamProps) {
  return (
    <section className={styles.executionPanel} aria-labelledby="execution-title">
      <h2 className={styles.panelEyebrow} id="execution-title">PUBLIC TASK ACTIVITY</h2>
      {events.length ? (
        <ol className={styles.executionList} aria-label="Observable task activity">
          {events.map((event) => (
            <li className={styles.executionItem} key={event.id}>
              <span className={styles.executionMark} aria-hidden="true" />
              <span>{event.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.executionQuiet}>No public task activity available.</p>
      )}
    </section>
  );
}
