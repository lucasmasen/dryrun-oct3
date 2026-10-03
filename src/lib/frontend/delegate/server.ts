import "server-only";

import { decodeTaskView, type InitialLoad } from "./model";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

const unavailable = (): InitialLoad => ({
  kind: "error",
  message: "Task service is unavailable right now.",
});

export async function loadInitialTask(id: string): Promise<InitialLoad> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { kind: "missing" };
  }
  if (!isSupabaseConfigured()) return unavailable();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("id,prompt,response_type,options,status,budget_cents,created_at,result")
      .eq("id", id)
      .maybeSingle();
    if (error) return unavailable();
    if (!data) return { kind: "missing" };

    const { count, error: countError } = await supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("task_id", id);
    if (countError || count === null) return unavailable();

    const task = decodeTaskView({
      id: data.id,
      prompt: data.prompt,
      response_type: data.response_type,
      options: data.options,
      status: data.status,
      responses_count: count,
      budget_cents: data.budget_cents,
      created_at: data.created_at,
      ...(data.status === "closed" && data.result ? { result: data.result } : {}),
    });
    if (!task) return unavailable();

    return {
      kind: "ready",
      snapshot: { task, signals: [], signalsLoaded: false, receipt: null },
    };
  } catch {
    return unavailable();
  }
}
