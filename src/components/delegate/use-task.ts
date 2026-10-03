"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLiveAdapter } from "@/lib/frontend/delegate/client";
import type {
  ConnectionState,
  Surface,
  TaskAdapter,
  TaskSnapshot,
} from "@/lib/frontend/delegate/model";
import { TaskRequestError } from "@/lib/frontend/delegate/model";

export function useTask({
  id,
  surface,
  initial,
  adapter: suppliedAdapter,
}: {
  id: string;
  surface: Surface;
  initial: TaskSnapshot;
  adapter?: TaskAdapter;
}) {
  const adapter = useMemo(
    () => suppliedAdapter ?? createLiveAdapter(id, surface),
    [id, surface, suppliedAdapter],
  );
  const [load, setLoad] = useState(initial);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [readError, setReadError] = useState<TaskRequestError | null>(null);
  const connectionRef = useRef<ConnectionState>("connecting");
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let queued = false;
    let currentRead: Promise<void> | null = null;
    let controller: AbortController | null = null;

    const run = (): Promise<void> => {
      if (!active) return Promise.resolve();
      if (currentRead) {
        queued = true;
        return currentRead;
      }
      currentRead = (async () => {
        do {
          queued = false;
          controller = new AbortController();
          try {
            const snapshot = await adapter.read(controller.signal);
            if (!active) return;
            setLoad(snapshot);
            setReadError(null);
            setConnection(connectionRef.current);
          } catch (error) {
            if (!active) return;
            const requestError = error instanceof TaskRequestError
              ? error
              : new TaskRequestError(error instanceof Error ? error.message : "Could not refresh this task.", null);
            setReadError(requestError);
            setConnection("offline");
          }
        } while (active && queued);
      })().finally(() => {
        currentRead = null;
      });
      return currentRead;
    };

    refreshRef.current = run;
    const updateConnection = (state: ConnectionState) => {
      if (!active) return;
      connectionRef.current = state;
      setConnection(state);
    };
    const unsubscribe = adapter.subscribe(() => { void run(); }, updateConnection);
    void run();

    return () => {
      active = false;
      controller?.abort();
      unsubscribe();
      refreshRef.current = () => Promise.resolve();
    };
  }, [adapter]);

  return { load, connection, readError, adapter, refresh };
}
