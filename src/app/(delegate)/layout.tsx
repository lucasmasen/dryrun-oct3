import type { ReactNode } from 'react';
import styles from './delegate.module.css';

export default function DelegateLayout({ children }: { children: ReactNode }) {
  return <div className={styles.surface}>{children}</div>;
}
