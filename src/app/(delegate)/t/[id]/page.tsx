import { Fulfillment } from '@/components/delegate/fulfillment';
import { SurfaceState } from '@/components/delegate/surface-state';
import { initialDemo, type DemoResponseType } from '@/lib/frontend/delegate/demo';
import { loadInitialTask } from '@/lib/frontend/delegate/server';
import styles from '../../delegate.module.css';

export const dynamic = 'force-dynamic';

type TaskPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
};

export default async function TaskPage({ params, searchParams }: TaskPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (id === 'demo') {
    const responseType: DemoResponseType = query.type === 'text' ? 'text' : 'choice';
    return (
      <Fulfillment
        id={id}
        initial={initialDemo(responseType)}
        demoResponseType={responseType}
      />
    );
  }

  const initial = await loadInitialTask(id);

  if (initial.kind === 'missing') {
    return (
      <SurfaceState
        eyebrow="Unavailable"
        title="Task not found"
        message="This task link is invalid or the task is no longer available."
        role="alert"
      />
    );
  }

  if (initial.kind === 'error') {
    return (
      <SurfaceState
        eyebrow="Connection issue"
        title="The task could not load"
        message={initial.message}
        role="alert"
      >
        <a className={styles.action} href={`/t/${encodeURIComponent(id)}`}>
          Try again
        </a>
      </SurfaceState>
    );
  }

  return <Fulfillment id={id} initial={initial.snapshot} />;
}
