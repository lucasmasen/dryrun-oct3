'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEMO_UPDATE_EVENT, createDemoAdapter, replayDemo, type DemoResponseType } from '@/lib/frontend/delegate/demo';
import type { TaskSnapshot } from '@/lib/frontend/delegate/model';
import { SurfaceState } from './surface-state';
import { useTask } from './use-task';
import styles from '@/app/(delegate)/delegate.module.css';
import { ResponseForm } from './response-form';

type FulfillmentProps = {
  id: string;
  initial: TaskSnapshot;
  demoResponseType?: DemoResponseType;
};

type DemoUpdate = { responseType?: DemoResponseType; action?: string };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function Fulfillment({ id, initial, demoResponseType }: FulfillmentProps) {
  const demoAdapter = useMemo(
    () => demoResponseType ? createDemoAdapter(demoResponseType, 'phone') : undefined,
    [demoResponseType],
  );
  const { load, connection, readError, adapter, refresh } = useTask({
    id,
    surface: 'phone',
    initial,
    adapter: demoAdapter,
  });
  const [replayRevision, setReplayRevision] = useState(0);
  const [replayError, setReplayError] = useState<string | null>(null);
  const task = load.task;

  useEffect(() => {
    if (!demoResponseType) return;
    const handleDemoUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DemoUpdate>).detail;
      if (detail?.responseType === demoResponseType && detail.action === 'replay') {
        setReplayRevision((revision) => revision + 1);
      }
    };
    window.addEventListener(DEMO_UPDATE_EVENT, handleDemoUpdate);
    return () => window.removeEventListener(DEMO_UPDATE_EVENT, handleDemoUpdate);
  }, [demoResponseType]);

  function handleReplay() {
    if (!demoResponseType) return;
    setReplayError(null);
    try {
      replayDemo(demoResponseType);
    } catch (cause) {
      setReplayError(cause instanceof Error ? cause.message : 'Demo storage is unavailable.');
    }
  }

  function retryRead() {
    setReplayError(null);
    void refresh();
  }

  if (readError?.status === 404) {
    return (
      <SurfaceState
        eyebrow="Unavailable"
        title="Task not found"
        message="This task is no longer available."
        role="alert"
      />
    );
  }

  if (demoResponseType && (readError || replayError)) {
    return (
      <SurfaceState
        eyebrow="Demo storage"
        title="Demo unavailable"
        message={replayError ?? readError?.message ?? 'Local demo storage is unavailable.'}
        role="alert"
      >
        <div className={styles.form}>
          <button className={styles.action} type="button" onClick={retryRead}>
            Retry
          </button>
          <button className={styles.action} type="button" onClick={handleReplay}>
            Replay demo
          </button>
        </div>
      </SurfaceState>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <span className={styles.brand}>Human inference</span>
        <span className={styles.mastheadNote}>Response</span>
      </header>

      <section className={styles.content} aria-labelledby="task-prompt">
        <p className={styles.eyebrow}>A question for you</p>
        <h1 className={styles.prompt} id="task-prompt">{task.prompt}</h1>
        {task.budget_cents > 0 ? (
          <p className={styles.budget}>BUDGET · {usd.format(task.budget_cents / 100)}</p>
        ) : null}
        <ResponseForm
          key={`${demoResponseType ?? 'live'}:${replayRevision}`}
          task={task}
          receipt={load.receipt}
          submit={(input) => adapter.submit(input)}
          refresh={async () => { await refresh(); }}
          demoResponseType={demoResponseType}
          onReplay={demoResponseType ? handleReplay : undefined}
        />
      </section>

      {readError ? (
        <div className={styles.connection} role="status" aria-live="polite">
          <p>Couldn’t refresh. Showing the latest task information.</p>
          <button className={styles.action} type="button" onClick={() => { void refresh(); }}>
            Retry
          </button>
        </div>
      ) : connection === 'offline' ? (
        <div className={styles.connection} role="status" aria-live="polite">
          <p>Offline. Showing the latest task information.</p>
          <button className={styles.action} type="button" onClick={() => { void refresh(); }}>
            Retry
          </button>
        </div>
      ) : connection === 'polling' ? (
        <p className={styles.connection} role="status" aria-live="polite">
          Checking for updates periodically.
        </p>
      ) : null}
    </main>
  );
}
