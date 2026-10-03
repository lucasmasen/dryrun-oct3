import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import styles from '@/app/(delegate)/delegate.module.css';
import { deriveBoardPhase, type BoardPhase, type ConnectionState, type TaskSnapshot } from '@/lib/frontend/delegate/model';
import ExecutionStream, { type ExecutionEvent } from './execution-stream';
export type { ExecutionEvent } from './execution-stream';
import ResultPanel from './result-panel';
import SignalFeed from './signal-feed';
import { SignalMerge } from './effects';

export type AgentWorkspaceProps = {
  snapshot: TaskSnapshot;
  connection: ConnectionState;
  mode: 'real' | 'demo';
  mission: string;
  events: ExecutionEvent[];
  arrivingIds: ReadonlySet<string>;
  orb?: ReactNode;
  workspaceRef?: Ref<HTMLElement>;
  orbSlotRef?: Ref<HTMLDivElement>;
  staleMessage?: string | null;
  onRetry?: () => void;
};

const connectionLabels: Record<ConnectionState, string> = {
  connecting: 'CONNECTING',
  live: 'LIVE',
  polling: 'LIVE · POLLING FALLBACK',
  offline: 'OFFLINE · LAST UPDATE SHOWN',
};

const phaseLabels: Record<BoardPhase, string> = {
  connecting: 'Establishing connection',
  listening: 'Collecting human signals',
  weaving: 'Task closing',
  breathing: 'Result ready',
  closed: 'Task closed · result unavailable',
};

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}


export function AgentWorkspace({
  snapshot,
  connection,
  mode,
  mission,
  events,
  arrivingIds,
  orb,
  workspaceRef,
  orbSlotRef,
  staleMessage,
  onRetry,
}: AgentWorkspaceProps) {
  const { task } = snapshot;
  const phase = deriveBoardPhase(snapshot, connection);
  const orbContent = orb ?? null;

  return (
    <main className={styles.boardWorkspace} ref={workspaceRef}>
      <header className={styles.boardHeader}>
        <Link className={styles.boardBrand} href="/">HUMAN INFERENCE</Link>
        <div className={styles.boardHeaderMeta}>
          {mode === 'demo' ? <span className={styles.demoLabel}>DEMO · SIMULATED AGENT EXECUTION</span> : null}
          <span className={styles.connectionStatus} role="status" aria-live="polite" data-connection={connection}>
            <span className={styles.connectionMark} aria-hidden="true" />
            {connectionLabels[connection]}
          </span>
        </div>
      </header>

      {staleMessage ? (
        <div className={styles.staleNotice} role="status">
          <p>{staleMessage}</p>
          {onRetry ? <button className={styles.retryButton} onClick={onRetry} type="button">Retry</button> : null}
        </div>
      ) : null}

      <section className={styles.boardMission} aria-labelledby="board-mission-title">
        <div className={styles.missionEyebrow}>
          <span>{mode === 'demo' ? 'DETERMINISTIC DEMO FIXTURE' : 'TASK PROMPT'}</span>
          {task.status === 'open' ? <span className={styles.budgetLabel}>BUDGET · {formatUsd(task.budget_cents)}</span> : null}
        </div>
        <h1 className={styles.missionTitle} id="board-mission-title">{mission}</h1>
        {mode === 'demo' ? <p className={styles.missionCaption}>Simulated agent execution</p> : null}
      </section>

      <div className={styles.boardGrid}>
        <section className={styles.agentPanel} aria-labelledby="agent-panel-title">
          <div className={styles.agentPanelHeader}>
            <div className={styles.orbSlot} ref={orbSlotRef}>{orbContent}</div>
            <div className={styles.phaseBlock}>
              <p className={styles.panelEyebrow} id="agent-panel-title">AGENT STATE</p>
              <p className={styles.phaseLabel}>{phaseLabels[phase]}</p>
            </div>
          </div>
          {task.responses_count > 0 ? (
            <div className={styles.signalMergeHost}>
              <SignalMerge
                count={task.responses_count}
                closing={task.status === 'closing'}
                paused={connection === 'offline'}
              />
            </div>
          ) : null}

          <ExecutionStream events={events} />
          {task.status === 'closed' && task.result ? <ResultPanel snapshot={snapshot} paused={connection === 'offline'} /> : null}
        </section>

        <SignalFeed
          snapshot={snapshot}
          arrivingIds={arrivingIds}
          detailsFailed={Boolean(staleMessage)}
          paused={connection === 'offline'}
        />
      </div>

      {task.status !== 'closed' || !task.result ? <ResultPanel snapshot={snapshot} paused={connection === 'offline'} /> : null}

      <footer className={styles.boardFooter}>
        <Link className={styles.humanLink} href={`/t/${encodeURIComponent(task.id)}`}>
          Open human response <span aria-hidden="true">↗</span>
        </Link>
        <span className={styles.taskStatus}>{task.status.toUpperCase()}</span>
      </footer>
    </main>
  );
}

