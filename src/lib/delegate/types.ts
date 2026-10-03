// THE CONTRACT — matches the team API spec. Change only by announcing it.
export type ResponseType = 'text' | 'choice' | 'photo' | 'live';
export type TaskStatus = 'open' | 'closing' | 'closed';
export type ResponseStatus = 'pending' | 'accepted' | 'rejected';

// DB row (board subscribes to this via realtime)
export interface Task {
  id: string;
  prompt: string;
  response_type: ResponseType;
  options: string[] | null;
  budget_cents: number;
  min_responses: number;
  status: TaskStatus;
  payment_intent_id: string | null;
  result: TaskResult | null;
  closes_at: string;
  created_at: string;
  // live tasks only
  assigned_response_id?: string | null;
  live_started_at?: string | null;
}

// DB row. content = "answer", worker_name = "name" in the API.
export interface TaskResponse {
  id: string;
  task_id: string;
  worker_name: string;
  content: string;
  photo_url: string | null;
  status: ResponseStatus;
  screen_reason: string | null;
  payout_cents: number;
  created_at: string;
}

// 1. POST /api/tasks
export interface CreateTaskInput {
  prompt: string;
  response_type: ResponseType;
  options?: string[];
  budget_cents?: number;
  min_responses?: number;
  ttl_seconds?: number;
}

// 3. POST /api/tasks/:id/responses
export interface SubmitResponseInput {
  answer: string;
  name?: string;
  photo_url?: string;
}

// 4. returned by close, and by GET /api/tasks/:id once closed
export interface TaskResult {
  summary: string;
  winner: string;
  tally?: Record<string, number>;
  responses: { answer: string; name: string }[];
  rejected: number;
  paid: { total_cents: number; per_human_cents: number; stripe: string | null };
}

// 2. GET /api/tasks/:id
export interface TaskView {
  id: string;
  prompt: string;
  response_type: ResponseType;
  options: string[] | null;
  status: TaskStatus;
  responses_count: number;
  budget_cents: number;
  created_at: string;
  result?: TaskResult;
}

// GET /api/tasks/:id/live  (live video tasks)
export interface LiveView {
  id: string;
  prompt: string;
  status: TaskStatus;
  budget_cents: number;
  claims: { id: string; name: string; created_at: string }[];
  claim_window_seconds: number;
  selects_at: string | null;          // when auto-select happens (null until first volunteer)
  assigned: { claim_id: string; name: string } | null;
  live_started_at: string | null;
  result: TaskResult | null;
}
