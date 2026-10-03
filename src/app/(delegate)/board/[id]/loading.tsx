import styles from '@/app/(delegate)/delegate.module.css';

export default function BoardLoading() {
  return (
    <main className={styles.boardWorkspace} aria-busy="true" aria-label="Loading agent workspace">
      <header className={styles.boardHeader}>
        <span className={styles.boardBrand}>HUMAN INFERENCE</span>
        <span className={styles.boardHeaderNote}>AGENT WORKSPACE</span>
      </header>
      <section className={styles.boardLoading}>
        <span className={styles.boardSkeletonEyebrow} />
        <span className={styles.boardSkeletonMission} />
        <div className={styles.boardSkeletonGrid}>
          <span className={styles.boardSkeletonPanel} />
          <span className={styles.boardSkeletonPanel} />
        </div>
      </section>
    </main>
  );
}
