import type { ReactNode } from 'react';
import styles from '@/app/(delegate)/delegate.module.css';
import LiveBoard from '@/components/delegate/live-board';
import DemoWorkspace from '@/components/delegate/demo-workspace';
import { loadInitialTask } from '@/lib/frontend/delegate/server';

export const dynamic = 'force-dynamic';

type BoardPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
};

export default async function BoardPage({ params, searchParams }: BoardPageProps) {
  const { id } = await params;
  if (id === 'demo') {
    const query = await searchParams;
    return <DemoWorkspace responseType={query.type === 'text' ? 'text' : 'choice'} />;
  }
  const initial = await loadInitialTask(id);

  if (initial.kind === 'missing') {
    return (
      <BoardState
        eyebrow="TASK NOT FOUND"
        title="This task is unavailable"
        message="Check the task link or ask the agent to share a current one."
      />
    );
  }

  if (initial.kind === 'error') {
    return (
      <BoardState
        eyebrow="CONNECTION UNAVAILABLE"
        title="Couldn’t load this task"
        message={initial.message}
      >
        <a className={styles.boardStateAction} href={`/board/${encodeURIComponent(id)}`}>Retry</a>
      </BoardState>
    );
  }

  return <LiveBoard key={id} id={id} initial={initial.snapshot} />;
}

function BoardState({
  eyebrow,
  title,
  message,
  children,
}: {
  eyebrow: string;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className={styles.boardStatePage}>
      <header className={styles.boardHeader}>
        <span className={styles.boardBrand}>HUMAN INFERENCE</span>
        <span className={styles.boardHeaderNote}>AGENT WORKSPACE</span>
      </header>
      <section className={styles.boardState} role="status">
        <p className={styles.boardStateEyebrow}>{eyebrow}</p>
        <h1 className={styles.boardStateTitle}>{title}</h1>
        <p className={styles.boardStateMessage}>{message}</p>
        {children ? <div className={styles.boardStateActions}>{children}</div> : null}
      </section>
    </main>
  );
}
