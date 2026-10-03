'use client';

import styles from '@/app/(delegate)/delegate.module.css';

type BoardErrorProps = { error: Error & { digest?: string }; retry: () => void };

export default function BoardError({ retry }: BoardErrorProps) {
  return (
    <main className={styles.boardStatePage}>
      <header className={styles.boardHeader}>
        <span className={styles.boardBrand}>HUMAN INFERENCE</span>
        <span className={styles.boardHeaderNote}>AGENT WORKSPACE</span>
      </header>
      <section className={styles.boardState} role="alert" aria-live="assertive">
        <p className={styles.boardStateEyebrow}>WORKSPACE ERROR</p>
        <h1 className={styles.boardStateTitle}>This workspace could not render</h1>
        <p className={styles.boardStateMessage}>The workspace failed to render. Retry to load task data again.</p>
        <button className={styles.boardStateAction} onClick={retry} type="button">Retry workspace</button>
      </section>
    </main>
  );
}
