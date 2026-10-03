import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  decodeApiSignals,
  decodeDatabaseSignals,
  decodeRealtimeConfig,
  decodeSubmitReceipt,
  decodeTaskView,
  TaskRequestError,
  type ConnectionState,
  type Surface,
  type SubmitReceipt,
  type TaskAdapter,
  type HumanSignal,
  type TaskSnapshot,
} from "./model";
import type { SubmitResponseInput, TaskView } from "@/lib/delegate/types";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export function createLiveAdapter(id: string, surface: Surface): TaskAdapter {
  const taskPath = `/api/tasks/${encodeURIComponent(id)}`;
  const receiptKey = `delegate:receipt:${id}`;
  let realtimeClientPromise: Promise<SupabaseClient | null> | null = null;
  let currentSnapshot: TaskSnapshot | null = null;
  let invalidateCurrent: (() => void) | null = null;

  async function getRealtimeClient() {
    if (!realtimeClientPromise) {
      const attempt = (async () => {
        try {
          const response = await fetch("/api/realtime", { cache: "no-store" });
          if (!response.ok) return null;
          const config = decodeRealtimeConfig(await response.json().catch(() => null));
          if (!config) return null;
          return createClient(config.url, config.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
        } catch {
          return null;
        }
      })();
      realtimeClientPromise = attempt;
      const client = await attempt;
      if (!client && realtimeClientPromise === attempt) realtimeClientPromise = null;
      return client;
    }
    return realtimeClientPromise;
  }

  async function readTask(signal: AbortSignal): Promise<TaskView> {
    let response: Response;
    try {
      response = await fetch(taskPath, { cache: "no-store", signal });
    } catch {
      throw new TaskRequestError("Could not refresh this task.", null);
    }
    if (!response.ok) {
      throw new TaskRequestError(await errorMessage(response, "Could not refresh this task."), response.status);
    }
    const task = decodeTaskView(await response.json().catch(() => null));
    if (!task) throw new TaskRequestError("Task response was invalid.", null);
    return task;
  }

  async function readSignals(signal: AbortSignal) {
    const client = await getRealtimeClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("responses")
          .select("id,task_id,content,worker_name,status,screen_reason,created_at")
          .eq("task_id", id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .abortSignal(signal);
        const signals = !error && decodeDatabaseSignals(data, id);
        if (signals) return signals;
      } catch {
        // Read-only HTTP fallback below.
      }
    }

    let response: Response;
    try {
      response = await fetch(`${taskPath}/responses`, { cache: "no-store", signal });
    } catch {
      throw new TaskRequestError("Could not refresh human signals.", null);
    }
    if (!response.ok) {
      throw new TaskRequestError(await errorMessage(response, "Could not refresh human signals."), response.status);
    }
    const signals = decodeApiSignals(await response.json().catch(() => null));
    if (!signals) throw new TaskRequestError("Human signal response was invalid.", null);
    return signals;
  }

  function readReceipt(): SubmitReceipt | null {
    if (surface !== "phone" || typeof window === "undefined") return null;
    try {
      const value = window.sessionStorage.getItem(receiptKey);
      const receipt = value ? decodeSubmitReceipt(JSON.parse(value)) : null;
      return receipt?.accepted ? receipt : null;
    } catch {
      return null;
    }
  }

  function saveReceipt(receipt: SubmitReceipt) {
    if (!receipt.accepted || surface !== "phone" || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(receiptKey, JSON.stringify(receipt));
    } catch {
      // Storage failure cannot undo a confirmed server receipt.
    }
  }

  return {
    async read(signal) {
      const task = await readTask(signal);
      let signals: HumanSignal[] = [];
      let signalsLoaded = false;
      if (surface === "board") {
        try {
          signals = await readSignals(signal);
          signalsLoaded = true;
        } catch {
          signals = currentSnapshot?.signals ?? [];
        }
      }
      const snapshot: TaskSnapshot = {
        task,
        signals,
        signalsLoaded,
        receipt: readReceipt(),
      };
      currentSnapshot = snapshot;
      return snapshot;
    },

    async submit(input: SubmitResponseInput) {
      let response: Response;
      try {
        response = await fetch(`${taskPath}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: input.answer }),
        });
      } catch {
        throw new TaskRequestError("Delivery unconfirmed. Resending may create a duplicate.", null);
      }
      if (!response.ok) {
        const message = response.status >= 500
          ? "Delivery unconfirmed. Resending may create a duplicate."
          : await errorMessage(response, "Response could not be submitted.");
        if (response.status === 409) invalidateCurrent?.();
        throw new TaskRequestError(message, response.status);
      }
      const receipt = response.status === 201
        ? decodeSubmitReceipt(await response.json().catch(() => null))
        : null;
      if (!receipt) {
        throw new TaskRequestError("Delivery unconfirmed. Resending may create a duplicate.", null);
      }
      saveReceipt(receipt);
      invalidateCurrent?.();
      return receipt;
    },

    subscribe(invalidate, onConnection) {
      if (typeof window === "undefined") return () => {};
      let disposed = false;
      let unsubscribeChannel: (() => void) | null = null;
      let connected = false;
      invalidateCurrent = invalidate;

      const setConnection = (state: ConnectionState) => {
        if (!disposed) onConnection(state);
      };
      const invalidateVisible = () => {
        if (!disposed && document.visibilityState === "visible") invalidate();
      };
      const handleOffline = () => setConnection("offline");
      const handleOnline = () => {
        setConnection(connected ? "live" : "polling");
        invalidateVisible();
      };
      const handleVisibility = () => {
        if (document.visibilityState === "visible") invalidate();
      };

      const reconcileTimer = setInterval(() => {
        if (currentSnapshot?.task.status === "closed" && currentSnapshot.task.result) {
          clearInterval(reconcileTimer);
          return;
        }
        invalidateVisible();
      }, 1500);
      window.addEventListener("focus", invalidateVisible);
      window.addEventListener("offline", handleOffline);
      window.addEventListener("online", handleOnline);
      document.addEventListener("visibilitychange", handleVisibility);
      setConnection(navigator.onLine ? "connecting" : "offline");

      void getRealtimeClient().then((client) => {
        if (disposed) return;
        if (!client) {
          setConnection(navigator.onLine ? "polling" : "offline");
          return;
        }
        try {
          let nextChannel = client
            .channel(`delegate:${surface}:${id}`)
            .on("postgres_changes", {
              event: "UPDATE",
              schema: "public",
              table: "tasks",
              filter: `id=eq.${id}`,
            }, invalidate);
          if (surface === "board") {
            nextChannel = nextChannel
              .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "responses",
                filter: `task_id=eq.${id}`,
              }, invalidate)
              .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "responses",
                filter: `task_id=eq.${id}`,
              }, invalidate);
          }
          unsubscribeChannel = () => { void nextChannel.unsubscribe(); };
          nextChannel.subscribe((status) => {
            if (disposed) return;
            connected = status === "SUBSCRIBED";
            setConnection(connected ? "live" : navigator.onLine ? "polling" : "offline");
            if (connected) invalidate();
          });
        } catch {
          setConnection(navigator.onLine ? "polling" : "offline");
        }
      });

      return () => {
        disposed = true;
        clearInterval(reconcileTimer);
        window.removeEventListener("focus", invalidateVisible);
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener("online", handleOnline);
        document.removeEventListener("visibilitychange", handleVisibility);
        unsubscribeChannel?.();
        if (invalidateCurrent === invalidate) invalidateCurrent = null;
      };
    },
  };
}
