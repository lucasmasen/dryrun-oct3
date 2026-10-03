'use client';

import styles from '../../delegate.module.css';
import { SurfaceState } from '@/components/delegate/surface-state';

type TaskErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function TaskError({ retry }: TaskErrorProps) {
  return (
    <SurfaceState
      eyebrow="Unavailable"
      title="This task could not load"
      message="Check your connection, then try loading the task again."
      role="alert"
    >
      <button className={styles.action} type="button" onClick={retry}>
        Try again
      </button>
    </SurfaceState>
  );
}
