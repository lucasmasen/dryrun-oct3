import styles from '../../delegate.module.css';
import { SurfaceState } from '@/components/delegate/surface-state';

export default function LoadingTask() {
  return (
    <SurfaceState
      eyebrow="Loading"
      title="Loading the task"
      message="The question will appear here."
      role="status"
    >
      <span className={styles.skeleton} aria-hidden="true" />
    </SurfaceState>
  );
}
