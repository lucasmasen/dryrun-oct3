import type { ReactNode } from 'react';
import styles from '@/app/(delegate)/delegate.module.css';

type SurfaceStateProps = {
  eyebrow: string;
  title: string;
  message: string;
  role?: 'status' | 'alert';
  children?: ReactNode;
};

export function SurfaceState({
  eyebrow,
  title,
  message,
  role = 'status',
  children,
}: SurfaceStateProps) {
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <span className={styles.brand}>Human inference</span>
        <span className={styles.mastheadNote}>Response</span>
      </header>
      <section className={styles.state} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
        <span className={styles.stateMark} aria-hidden="true" />
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.stateTitle}>{title}</h1>
        <p className={styles.stateMessage}>{message}</p>
        {children ? <div className={styles.stateAction}>{children}</div> : null}
      </section>
    </main>
  );
}
