"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "@/app/(delegate)/delegate.module.css";
import { deriveBoardPhase } from "@/lib/frontend/delegate/model";
import {
  createDemoAdapter,
  DEMO_CLOSE_AT_MS,
  DEMO_DEFAULT_MISSION,
  DEMO_RESULT_AT_MS,
  DEMO_RETURN_AT_MS,
  DEMO_UPDATE_EVENT,
  demoStorageKey,
  initialDemo,
  readDemoRun,
  replayDemo,
  startDemo,
  type DemoResponseType,
  type DemoRun,
  type DemoUpdate,
} from "@/lib/frontend/delegate/demo";
import { useTask } from "./use-task";
import { AgentWorkspace, type ExecutionEvent } from "./agent-workspace";
import { AgentOrb } from "./effects";

const TIMELINE: readonly { id: string; label: string; at: number }[] = [
  { id: "understanding", label: "Understanding request", at: 0 },
  { id: "delegate", label: "Calling delegate_to_human()", at: 700 },
  { id: "collecting", label: "Collecting human signals", at: 1_400 },
  { id: "synthesizing", label: "Synthesizing result", at: DEMO_CLOSE_AT_MS },
  { id: "result", label: "Result ready", at: DEMO_RESULT_AT_MS },
  { id: "returned", label: "RETURNED TO AGENT ↗", at: DEMO_RETURN_AT_MS },
];

type Stage = "entry" | "running";
type SignalBaseline = { runId: string; ids: Set<string>; initialized: boolean };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Demo storage is unavailable. Retry or replay this demo.";
}

export default function DemoWorkspace({ responseType }: { responseType: DemoResponseType }) {
  const initial = useMemo(() => initialDemo(responseType), [responseType]);
  const adapter = useMemo(() => createDemoAdapter(responseType, "board"), [responseType]);
  const { load: snapshot, connection, readError, refresh } = useTask({
    id: "demo",
    surface: "board",
    initial,
    adapter,
  });
  const [stage, setStage] = useState<Stage>("entry");
  const [run, setRun] = useState<DemoRun | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [missionDraft, setMissionDraft] = useState("");
  const [controllerError, setControllerError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [arrivingIds, setArrivingIds] = useState<ReadonlySet<string>>(() => new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const orbHostRef = useRef<HTMLDivElement>(null);
  const entryAnchorRef = useRef<HTMLDivElement>(null);
  const workspaceOrbSlotRef = useRef<HTMLDivElement>(null);
  const previousOrbRectRef = useRef<DOMRect | null>(null);
  const stageRef = useRef<Stage>("entry");
  const runRef = useRef<DemoRun | null>(null);
  const startingRef = useRef(false);
  const baselineRef = useRef<SignalBaseline | null>(null);
  const arrivalTimersRef = useRef(new Map<string, number>());

  const moveOrbTo = useCallback((nextStage: Stage) => {
    if (stageRef.current === nextStage) return;
    previousOrbRectRef.current = orbHostRef.current?.getBoundingClientRect() ?? null;
    stageRef.current = nextStage;
    setStage(nextStage);
  }, []);

  const enterRun = useCallback((nextRun: DemoRun) => {
    if (stageRef.current === "running" && runRef.current?.id === nextRun.id) return;
    runRef.current = nextRun;
    setRun(nextRun);
    setClockNow(Date.now());
    moveOrbTo("running");
    setMissionDraft("");
    setControllerError(null);
    setFormError(null);
  }, [moveOrbTo]);

  const returnToEntry = useCallback(() => {
    runRef.current = null;
    baselineRef.current = null;
    setRun(null);
    setClockNow(0);
    moveOrbTo("entry");
    setMissionDraft("");
    setFormError(null);
    startingRef.current = false;
    setArrivingIds(new Set());
    for (const timer of arrivalTimersRef.current.values()) window.clearTimeout(timer);
    arrivalTimersRef.current.clear();
  }, [moveOrbTo]);

  const syncRun = useCallback(() => {
    try {
      const storedRun = readDemoRun(responseType);
      setControllerError(null);
      if (storedRun) enterRun(storedRun);
      else returnToEntry();
      void refresh();
    } catch (error) {
      setControllerError(errorMessage(error));
    }
  }, [enterRun, refresh, responseType, returnToEntry]);

  useEffect(() => {
    const onDemoUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DemoUpdate>).detail;
      if (detail?.responseType !== responseType) return;
      if (detail.action === "replay") {
        setControllerError(null);
        returnToEntry();
        void refresh();
      } else {
        syncRun();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === demoStorageKey(responseType)) syncRun();
    };
    const onForeground = () => syncRun();
    window.addEventListener(DEMO_UPDATE_EVENT, onDemoUpdate);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onForeground);
    window.addEventListener("pageshow", onForeground);
    const initialSync = window.setTimeout(syncRun, 0);
    return () => {
      window.clearTimeout(initialSync);
      window.removeEventListener(DEMO_UPDATE_EVENT, onDemoUpdate);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [refresh, responseType, returnToEntry, syncRun]);

  const runStartedAt = run?.startedAt;
  useEffect(() => {
    if (stage !== "running" || runStartedAt === undefined) return;
    let interval = 0;
    interval = window.setInterval(() => {
      const current = Date.now();
      setClockNow(current);
      if (current - runStartedAt >= DEMO_RETURN_AT_MS) window.clearInterval(interval);
    }, 250);
    return () => window.clearInterval(interval);
  }, [runStartedAt, stage]);


  useLayoutEffect(() => {
    const first = previousOrbRectRef.current;
    previousOrbRectRef.current = null;
    const host = orbHostRef.current;
    const canvas = canvasRef.current;
    const target = (stage === "running" ? workspaceOrbSlotRef : entryAnchorRef).current;
    if (!first || !host || !canvas || !target) return;

    const targetRect = target.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    host.style.left = `${targetRect.left - canvasRect.left - canvas.clientLeft}px`;
    host.style.top = `${targetRect.top - canvasRect.top - canvas.clientTop}px`;
    host.style.width = `${targetRect.width}px`;
    host.style.height = `${targetRect.height}px`;
    host.style.transition = "none";
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduceMotion) {
      host.style.transform = "";
      return;
    }

    host.style.transform = `translate(${first.left - targetRect.left}px, ${first.top - targetRect.top}px)`;
    void host.offsetWidth;
    const frame = window.requestAnimationFrame(() => {
      host.style.transition = "transform 250ms cubic-bezier(0.23, 1, 0.32, 1)";
      host.style.transform = "translate(0, 0)";
    });
    const timeout = window.setTimeout(() => {
      host.style.transition = "";
      host.style.transform = "";
    }, 270);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [stage]);

  useEffect(() => () => {
    for (const timer of arrivalTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage !== "running" || !run) return;
    const runStartedAt = new Date(run.startedAt).toISOString();
    if (snapshot.task.created_at !== runStartedAt) {
      baselineRef.current = { runId: run.id, ids: new Set(), initialized: false };
      return;
    }

    const ids = new Set(snapshot.signals.map((signal) => signal.id));
    const previous = baselineRef.current;
    if (!previous || previous.runId !== run.id || !previous.initialized) {
      baselineRef.current = { runId: run.id, ids, initialized: true };
      return;
    }
    const arrivals = [...ids].filter((id) => !previous.ids.has(id));
    baselineRef.current = { runId: run.id, ids, initialized: true };
    if (!arrivals.length) return;

    setArrivingIds((current) => {
      const next = new Set(current);
      for (const id of arrivals) next.add(id);
      return next;
    });
    for (const id of arrivals) {
      const priorTimer = arrivalTimersRef.current.get(id);
      if (priorTimer !== undefined) window.clearTimeout(priorTimer);
      arrivalTimersRef.current.set(id, window.setTimeout(() => {
        arrivalTimersRef.current.delete(id);
        setArrivingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 2_000));
    }
  }, [stage, run, snapshot.signals, snapshot.task.created_at]);

  const handleStart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (startingRef.current || !missionDraft.trim() || missionDraft.trim().length > 1_000) return;
    startingRef.current = true;
    setFormError(null);
    try {
      enterRun(startDemo(missionDraft, responseType));
    } catch (error) {
      startingRef.current = false;
      setFormError(errorMessage(error));
      if (!(error instanceof Error && error.name === "DemoRequestError")) {
        setControllerError(errorMessage(error));
      }
    }
  };

  const handleReplay = () => {
    try {
      replayDemo(responseType);
      setControllerError(null);
      returnToEntry();
      void refresh();
    } catch (error) {
      setControllerError(errorMessage(error));
    }
  };

  const handleRetry = () => syncRun();
  const handleEntryKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const phase = stage === "entry" ? "breathing" : deriveBoardPhase(snapshot, connection);
  const orbPaused = connection === "offline";
  const elapsed = run ? Math.max(0, clockNow - run.startedAt) : 0;
  const events: ExecutionEvent[] = run
    ? TIMELINE.filter((event) => elapsed >= event.at).map(({ id, label }) => ({ id: `${run.id}:${id}`, label }))
    : [];
  const displayedError = controllerError ?? readError?.message ?? null;
  const snapshotMatchesRun = run !== null && snapshot.task.created_at === new Date(run.startedAt).toISOString();
  const cannotRenderCurrentRun = stage === "running" && displayedError !== null && !snapshotMatchesRun;

  return (
    <div className={styles.demoWorkspace} data-stage={stage} ref={canvasRef}>
      <div className={styles.demoOrbHost} ref={orbHostRef} aria-hidden="true">
        <AgentOrb key="demo-orb" phase={phase} paused={orbPaused} />
      </div>

      {stage === "entry" ? (
        <>
          <div className={styles.demoOrbAnchor} ref={entryAnchorRef} aria-hidden="true" />
          {displayedError ? (
            <section className={styles.demoError} role="alert" aria-labelledby="demo-error-title">
              <h1 id="demo-error-title">Demo unavailable</h1>
              <p>{displayedError}</p>
              <div className={styles.demoErrorActions}>
                <button onClick={handleRetry} type="button">Retry</button>
                <button onClick={handleReplay} type="button">Replay demo</button>
              </div>
            </section>
          ) : (
            <section className={styles.demoEntry} aria-labelledby="demo-entry-title">
              <p className={styles.demoCaption}>DEMO · SIMULATED AGENT EXECUTION</p>
              <h1 id="demo-entry-title">What do you need?</h1>
              <form className={styles.demoEntryForm} onSubmit={handleStart}>
                <label className={styles.demoEntryLabel} htmlFor="demo-mission">Describe the task</label>
                <div className={styles.demoInputShell}>
                  <textarea
                    autoComplete="off"
                    id="demo-mission"
                    maxLength={1_000}
                    onChange={(event) => setMissionDraft(event.currentTarget.value)}
                    onKeyDown={handleEntryKeyDown}
                    placeholder={DEMO_DEFAULT_MISSION}
                    rows={2}
                    value={missionDraft}
                  />
                  <button
                    aria-label="Start simulated task"
                    disabled={!missionDraft.trim() || missionDraft.trim().length > 1_000}
                    type="submit"
                  >
                    <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <p className={styles.demoInputHint}>Enter to start · Shift+Enter for a new line · 1–1,000 characters</p>
                {formError ? <p className={styles.demoFormError} role="status">{formError}</p> : null}
              </form>
            </section>
          )}
        </>
      ) : run ? (
        cannotRenderCurrentRun ? (
          <section className={styles.demoError} role="alert" aria-labelledby="demo-error-title">
            <h1 id="demo-error-title">Demo unavailable</h1>
            <p>{displayedError}</p>
            <div className={styles.demoErrorActions}>
              <button onClick={handleRetry} type="button">Retry</button>
              <button onClick={handleReplay} type="button">Replay demo</button>
            </div>
          </section>
        ) : (
          <>
            <AgentWorkspace
              snapshot={snapshot}
              connection={connection}
              mode="demo"
              mission={run.mission}
              events={events}
              arrivingIds={arrivingIds}
              orb={null}
              orbSlotRef={workspaceOrbSlotRef}
              staleMessage={displayedError}
              onRetry={handleRetry}
            />
            <button className={styles.demoReplayButton} onClick={handleReplay} type="button">Replay demo</button>
          </>
        )
      ) : null}
    </div>
  );
}
