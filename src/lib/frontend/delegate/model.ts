import { z } from "zod";
import type {
  ResponseStatus,
  SubmitResponseInput,
  TaskResult,
  TaskResponse,
  TaskView,
} from "@/lib/delegate/types";

export type Surface = "phone" | "board";

export type HumanSignal = {
  id: string;
  answer: string;
  name: string;
  status: ResponseStatus;
  reason: string | null;
  createdAt: string;
};

export type SubmitReceipt = { ok: true; id: string; accepted: boolean; reason: string };

export type TaskSnapshot = {
  task: TaskView;
  signals: HumanSignal[];
  signalsLoaded: boolean;
  receipt: SubmitReceipt | null;
};

export type InitialLoad =
  | { kind: "ready"; snapshot: TaskSnapshot }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export type ConnectionState = "connecting" | "live" | "polling" | "offline";
export type BoardPhase = "connecting" | "listening" | "weaving" | "breathing" | "closed";

export interface TaskAdapter {
  read(signal: AbortSignal): Promise<TaskSnapshot>;
  submit(input: SubmitResponseInput): Promise<SubmitReceipt>;
  subscribe(invalidate: () => void, connection: (state: ConnectionState) => void): () => void;
}

export class TaskRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "TaskRequestError";
    this.status = status;
  }
}

type DatabaseSignal = Pick<
  TaskResponse,
  "id" | "task_id" | "content" | "worker_name" | "status" | "screen_reason" | "created_at"
>;

const ResponseStatusSchema = z.enum(["pending", "accepted", "rejected"]);
const TaskResultSchema: z.ZodType<TaskResult> = z.object({
  summary: z.string(),
  winner: z.string(),
  tally: z.record(z.string(), z.number().int().nonnegative()).optional(),
  responses: z.array(z.object({ answer: z.string(), name: z.string() })),
  rejected: z.number().int().nonnegative(),
  paid: z.object({
    total_cents: z.number().int().nonnegative(),
    per_human_cents: z.number().int().nonnegative(),
    stripe: z.string().nullable(),
  }),
});
const TaskViewSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  response_type: z.enum(["text", "choice", "photo", "live"]),
  options: z.array(z.string()).nullable(),
  status: z.enum(["open", "closing", "closed"]),
  responses_count: z.number().int().nonnegative(),
  budget_cents: z.number().int().nonnegative(),
  created_at: z.string(),
  result: TaskResultSchema.optional(),
});
const ReceiptSchema = z.object({
  ok: z.literal(true),
  id: z.string().min(1),
  accepted: z.boolean(),
  reason: z.string(),
});
const DatabaseSignalsSchema = z.array(z.object({
  id: z.string().min(1),
  task_id: z.string().uuid(),
  content: z.string(),
  worker_name: z.string(),
  status: ResponseStatusSchema,
  screen_reason: z.string().nullable(),
  created_at: z.string(),
}));
const ApiSignalsSchema = z.array(z.object({
  answer: z.string(),
  name: z.string(),
  status: ResponseStatusSchema,
  reason: z.string().nullable(),
  created_at: z.string(),
}));
const RealtimeConfigSchema = z.object({
  url: z.string().url().nullable(),
  anonKey: z.string().min(1).nullable(),
});

export function decodeTaskView(value: unknown): TaskView | null {
  const parsed = TaskViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function decodeSubmitReceipt(value: unknown): SubmitReceipt | null {
  const parsed = ReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function decodeRealtimeConfig(value: unknown): { url: string; anonKey: string } | null {
  const parsed = RealtimeConfigSchema.safeParse(value);
  if (!parsed.success || !parsed.data.url || !parsed.data.anonKey) return null;
  return { url: parsed.data.url, anonKey: parsed.data.anonKey };
}

export function decodeDatabaseSignals(value: unknown, taskId: string): HumanSignal[] | null {
  const parsed = DatabaseSignalsSchema.safeParse(value);
  if (!parsed.success) return null;
  const rows = parsed.data satisfies DatabaseSignal[];
  if (rows.some((row) => row.task_id.toLowerCase() !== taskId.toLowerCase())) return null;
  return rows.map((row) => ({
    id: row.id,
    answer: row.content,
    name: row.worker_name,
    status: row.status,
    reason: row.screen_reason,
    createdAt: row.created_at,
  }));
}

export function decodeApiSignals(value: unknown): HumanSignal[] | null {
  const parsed = ApiSignalsSchema.safeParse(value);
  if (!parsed.success) return null;
  const duplicates = new Map<string, number>();
  return parsed.data.map((row) => {
    const tuple = JSON.stringify([row.created_at, row.name, row.answer]);
    const ordinal = duplicates.get(tuple) ?? 0;
    duplicates.set(tuple, ordinal + 1);
    return {
      id: `http:${JSON.stringify([row.created_at, row.name, row.answer, ordinal])}`,
      answer: row.answer,
      name: row.name,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
    };
  });
}



export function signalCounts(snapshot: TaskSnapshot): {
  submitted: number;
  verified: number;
  screening: number;
  rejected: number;
} | null {
  if (snapshot.task.status === "closed" && snapshot.task.result) {
    return {
      submitted: snapshot.task.responses_count,
      verified: snapshot.task.result.responses.length,
      screening: 0,
      rejected: snapshot.task.result.rejected,
    };
  }
  if (!snapshot.signalsLoaded || snapshot.signals.length !== snapshot.task.responses_count) return null;
  let verified = 0;
  let screening = 0;
  let rejected = 0;
  for (const signal of snapshot.signals) {
    if (signal.status === "accepted") verified++;
    else if (signal.status === "pending") screening++;
    else rejected++;
  }
  return { submitted: snapshot.task.responses_count, verified, screening, rejected };
}

export function signalIdentityKeys(signals: readonly HumanSignal[]): string[] {
  const ordinals = new Map<string, number>();
  return signals.map((signal) => {
    const identity = JSON.stringify([signal.createdAt, signal.name, signal.answer]);
    const ordinal = ordinals.get(identity) ?? 0;
    ordinals.set(identity, ordinal + 1);
    return JSON.stringify([identity, ordinal]);
  });
}

export function deriveBoardPhase(
  snapshot: TaskSnapshot | null,
  connection: ConnectionState,
): BoardPhase {
  if (!snapshot) return "connecting";
  const { status, responses_count: count, result } = snapshot.task;
  if (status === "closing") return "weaving";
  if (status === "closed") return result ? "breathing" : "closed";
  return count === 0 || connection === "connecting" ? "connecting" : "listening";
}
