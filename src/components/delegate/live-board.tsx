'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '@/app/(delegate)/delegate.module.css';
import {
  deriveBoardPhase,
  signalIdentityKeys,
  type TaskSnapshot,
} from '@/lib/frontend/delegate/model';
import { useTask } from './use-task';
import { AgentWorkspace } from './agent-workspace';
import type { ExecutionEvent } from './execution-stream';
import { AgentOrb } from './effects';

type LiveBoardProps = { id: string; initial: TaskSnapshot };

export default function LiveBoard({ id, initial }: LiveBoardProps) {
  const { load: snapshot, connection, readError, refresh } = useTask({
    id,
    surface: 'board',
    initial,
  });
  const [arrivingIds, setArrivingIds] = useState<ReadonlySet<string>>(() => new Set());
  const seenIds = useRef<Set<string> | null>(null);
  const arrivalTimers = useRef(new Map<string, number>());
  const phase = deriveBoardPhase(snapshot, connection);
  const events = executionEvents(snapshot);

  useEffect(() => {
    if (!snapshot.signalsLoaded || snapshot.signals.length !== snapshot.task.responses_count) return;

    const identities = signalIdentityKeys(snapshot.signals);
    const known = seenIds.current;
    if (known === null) {
      seenIds.current = new Set(identities);
      return;
    }

    const newIds = identities.filter((identity) => !known.has(identity));
    for (const identity of identities) known.add(identity);
    if (!newIds.length) return;

    setArrivingIds((current) => new Set([...current, ...newIds]));
    for (const identity of newIds) {
      const timer = window.setTimeout(() => {
        setArrivingIds((current) => {
          if (!current.has(identity)) return current;
          const next = new Set(current);
          next.delete(identity);
          return next;
        });
        arrivalTimers.current.delete(identity);
      }, 2000);
      arrivalTimers.current.set(identity, timer);
    }
  }, [snapshot.signals, snapshot.signalsLoaded, snapshot.task.responses_count]);

  useEffect(() => () => {
    for (const timer of arrivalTimers.current.values()) clearTimeout(timer);
    arrivalTimers.current.clear();
  }, []);

  if (readError?.status === 404) {
    return (
      <main className={styles.boardStatePage}>
        <header className={styles.boardHeader}>
          <span className={styles.boardBrand}>HUMAN INFERENCE</span>
          <span className={styles.boardHeaderNote}>AGENT WORKSPACE</span>
        </header>
        <section className={styles.boardState} role="status">
          <p className={styles.boardStateEyebrow}>TASK NOT FOUND</p>
          <h1 className={styles.boardStateTitle}>This task is unavailable</h1>
          <p className={styles.boardStateMessage}>Check the task link or ask the agent to share a current one.</p>
        </section>
      </main>
    );
  }

  const staleMessage = readError?.message ?? (connection === 'offline'
    ? 'Connection lost. Showing last known task and signals.'
    : null);

  return (
    <AgentWorkspace
      snapshot={snapshot}
      connection={connection}
      mode="real"
      mission={snapshot.task.prompt}
      events={events}
      arrivingIds={arrivingIds}
      orb={<AgentOrb phase={phase} paused={connection === 'offline'} />}
      staleMessage={staleMessage}
      onRetry={readError || connection === 'offline' ? () => { void refresh(); } : undefined}
    />
  );
}

function executionEvents(snapshot: TaskSnapshot): ExecutionEvent[] {
  const { task } = snapshot;
  if (task.status === 'closed') {
    return task.result ? [{ id: 'result-ready', label: 'Result ready' }] : [];
  }

  const pending = snapshot.signalsLoaded && snapshot.signals.some((signal) => signal.status === 'pending');
  if (task.status === 'closing') {
    return [
      ...(pending ? [{ id: 'screening', label: 'Screening response' }] : []),
      { id: 'synthesizing', label: 'Synthesizing result' },
    ];
  }

  return [
    { id: 'collecting', label: 'Collecting human signals' },
    ...(pending ? [{ id: 'screening', label: 'Screening response' }] : []),
  ];
}
