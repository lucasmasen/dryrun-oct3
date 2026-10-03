import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureActionFunding, createActionCheckout, syncActionFunding } from "./funding";
import { parseActionEvidence, verifyActionProof } from "./proof";
import {
  ActionStatusSchema, ActionTaskIdSchema, ActionTaskViewSchema,
  ClaimActionTaskSchema, CreateActionTaskSchema,
  type ActionStatus, type ActionTaskView, type ClaimActionTaskReceipt,
  type SubmitActionProofReceipt,
} from "./types";

type Database = SupabaseClient;
type ActionTaskRow = {
  id: string; prompt: string; proof_type: "text" | "photo"; proof_instructions: string;
  purchase_allowance_cents: number; worker_reward_cents: number; total_cents: number;
  status: ActionStatus; created_at: string;
  device_id_hash: string | null; claim_token_hash: string | null;
  proof_photo_path: string | null; proof_text: string | null;
  proof_status: "pending" | "accepted" | "rejected" | null; proof_reason: string | null;
  checkout_session_id: string | null; checkout_url: string | null;
  payment_intent_id: string | null; funding_status: "unfunded" | "held" | "captured";
  result: { summary: string; proof_text: string | null } | null;
};

export class ActionTaskError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const unavailable = (message: string) => new ActionTaskError(message, 503);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function actionTaskResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function actionTaskErrorResponse(error: unknown) {
  if (error instanceof ActionTaskError) return actionTaskResponse({ error: error.message }, error.status);
  if (error instanceof ZodError) {
    return actionTaskResponse({ error: error.issues.map((issue) => issue.message).join(" ") }, 400);
  }
  return actionTaskResponse({ error: "Action task service is unavailable." }, 503);
}

export async function readActionJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new ActionTaskError("Send a valid JSON body.", 400); }
}

async function readRow(db: Database, id: string): Promise<ActionTaskRow> {
  const { data, error } = await db.from("action_tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw unavailable("Action task could not be read.");
  if (!data) throw new ActionTaskError("Action task not found.", 404);
  return data as ActionTaskRow;
}

async function publicView(db: Database, row: ActionTaskRow): Promise<ActionTaskView> {
  let photoUrl: string | null = null;
  if (row.proof_status && row.proof_photo_path) {
    const { data, error } = await db.storage.from("action-proofs").createSignedUrl(row.proof_photo_path, 300);
    if (error || !data?.signedUrl) throw unavailable("Proof photo link could not be created.");
    photoUrl = data.signedUrl;
  }
  const completed = row.status === "completed";
  const view = ActionTaskViewSchema.safeParse({
    id: row.id, prompt: row.prompt, proof_type: row.proof_type,
    proof_instructions: row.proof_instructions,
    purchase_allowance_cents: row.purchase_allowance_cents,
    worker_reward_cents: row.worker_reward_cents, total_cents: row.total_cents,
    status: row.status, created_at: row.created_at,
    proof: row.proof_status ? {
      text: row.proof_text, photo_url: photoUrl,
      status: row.proof_status === "accepted" && !completed ? "pending" : row.proof_status,
      reason: row.proof_status === "accepted" && !completed ? null : row.proof_reason,
    } : null,
    result: completed && row.result ? {
      summary: row.result.summary, proof_text: row.result.proof_text, photo_url: photoUrl,
    } : null,
    funding: row.total_cents ? {
      status: row.funding_status,
      checkout_url: row.status === "awaiting_funding" ? row.checkout_url : null,
    } : null,
  });
  if (!view.success) throw unavailable("Action task data is invalid.");
  return view.data;
}

// Accepted evidence is durable before capture. A retry only settles funding; it never verifies again.
async function finalizeAccepted(db: Database, row: ActionTaskRow): Promise<ActionTaskRow> {
  if (row.status !== "verifying" || row.proof_status !== "accepted" || !row.result) return row;
  try {
    await captureActionFunding(row.id);
  } catch {
    const current = await readRow(db, row.id);
    if (current.status === "completed") return current;
    throw unavailable("Funding capture is unconfirmed. Refresh the task to retry finalization; do not resubmit proof.");
  }
  let update = db.from("action_tasks").update({ status: "completed" })
    .eq("id", row.id).eq("status", "verifying").eq("proof_status", "accepted").not("result", "is", null);
  if (row.total_cents > 0) update = update.eq("funding_status", "captured");
  const { data, error } = await update.select("*").maybeSingle();
  if (error) throw unavailable("Accepted proof finalization could not be saved. Refresh the task to retry.");
  if (data) return data as ActionTaskRow;
  const current = await readRow(db, row.id);
  if (current.status !== "completed") throw unavailable("Accepted proof is awaiting finalization.");
  return current;
}

async function refreshedRow(db: Database, row: ActionTaskRow): Promise<ActionTaskRow> {
  if (row.total_cents > 0 && row.status === "awaiting_funding") {
    try { await syncActionFunding(row.id); }
    catch { throw unavailable("Test funding could not be confirmed. Refresh to retry."); }
    row = await readRow(db, row.id);
  }
  if (row.status === "verifying" && row.proof_status === "accepted" && row.result) {
    try { return await finalizeAccepted(db, row); }
    catch (error) {
      // Keep the public pending state readable while payment infrastructure is unavailable.
      if (!(error instanceof ActionTaskError) || error.status !== 503) throw error;
      return readRow(db, row.id);
    }
  }
  return row;
}

export async function createActionTask(input: unknown, origin: string): Promise<ActionTaskView> {
  const parsed = CreateActionTaskSchema.parse(input);
  const db = createAdminClient();
  const total = parsed.purchase_allowance_cents + parsed.worker_reward_cents;
  const { data, error } = await db.from("action_tasks").insert({
    ...parsed, total_cents: total, status: total ? "awaiting_funding" : "open",
  }).select("*").single();
  if (error || !data) throw unavailable("Action task could not be created.");
  const row = data as ActionTaskRow;
  if (total > 0) {
    try { await createActionCheckout(row.id, { prompt: row.prompt, total_cents: total }, origin); }
    catch {
      const { error: deleteError } = await db.from("action_tasks").delete()
        .eq("id", row.id).eq("status", "awaiting_funding").eq("funding_status", "unfunded")
        .is("checkout_session_id", null);
      if (deleteError) throw unavailable("Checkout creation failed and the unfunded task could not be removed.");
      throw unavailable("Test checkout could not be created. No task is ready for workers.");
    }
    return publicView(db, await readRow(db, row.id));
  }
  return publicView(db, row);
}

export async function getActionTask(id: string): Promise<ActionTaskView> {
  ActionTaskIdSchema.parse(id);
  const db = createAdminClient();
  return publicView(db, await refreshedRow(db, await readRow(db, id)));
}

export async function listActionTasks(status: string | null = null): Promise<ActionTaskView[]> {
  if (status !== null) ActionStatusSchema.parse(status);
  const db = createAdminClient();
  // Sync before filtering so a just-funded task enters the open list immediately.
  const { data, error } = await db.from("action_tasks").select("*")
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw unavailable("Action tasks could not be listed.");
  const rows = await Promise.all(((data ?? []) as ActionTaskRow[]).map(async (row) => {
    try { return await refreshedRow(db, row); }
    catch (error) {
      if (error instanceof ActionTaskError && error.status === 503) return row;
      throw error;
    }
  }));
  return Promise.all(rows.filter((row) => status === null || row.status === status).map((row) => publicView(db, row)));
}

export async function claimActionTask(id: string, input: unknown): Promise<ClaimActionTaskReceipt> {
  ActionTaskIdSchema.parse(id);
  const { device_id } = ClaimActionTaskSchema.parse(input);
  const db = createAdminClient();
  const deviceHash = hash(device_id);
  const row = await readRow(db, id);
  if (row.device_id_hash === deviceHash) throw new ActionTaskError("This device has already claimed this task. Use its saved claim token.", 403);
  if (row.status !== "open") throw new ActionTaskError("Action task is not open for claims.", 409);
  const token = randomBytes(32).toString("hex");
  const { data, error } = await db.from("action_tasks").update({
    status: "claimed", device_id_hash: deviceHash, claim_token_hash: hash(token),
  }).eq("id", id).eq("status", "open").select("*").maybeSingle();
  if (error) throw unavailable("Action task could not be claimed.");
  if (!data) {
    const current = await readRow(db, id);
    if (current.device_id_hash === deviceHash) throw new ActionTaskError("This device has already claimed this task. Use its saved claim token.", 403);
    throw new ActionTaskError("Another worker has claimed this task.", 409);
  }
  return { claim_token: token, task: await publicView(db, data as ActionTaskRow) };
}

async function removePhoto(db: Database, path: string | null) {
  if (path) await db.storage.from("action-proofs").remove([path]);
}

export async function submitActionProof(id: string, form: FormData): Promise<SubmitActionProofReceipt> {
  ActionTaskIdSchema.parse(id);
  const db = createAdminClient();
  const row = await readRow(db, id);
  let evidence;
  try { evidence = await parseActionEvidence(form, row.proof_type); }
  catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ActionTaskError(error instanceof Error ? error.message : "Invalid proof submission.", 400);
  }
  const tokenHash = hash(evidence.claim_token);
  if (!row.claim_token_hash || !timingSafeEqual(Buffer.from(tokenHash, "hex"), Buffer.from(row.claim_token_hash, "hex"))) {
    throw new ActionTaskError("Claim token is invalid.", 403);
  }
  if (row.status !== "claimed") throw new ActionTaskError("Proof is already verifying or this task is not accepting proof.", 409);
  const photoPath = evidence.photo ? `${id}/${randomUUID()}` : null;
  if (evidence.photo && photoPath) {
    const { error } = await db.storage.from("action-proofs").upload(photoPath, evidence.photo.bytes, {
      contentType: evidence.photo.mime, upsert: false,
    });
    if (error) throw unavailable("Proof photo could not be stored. Retry submission.");
  }
  const { data: reserved, error: reserveError } = await db.from("action_tasks").update({
    status: "verifying", proof_status: "pending", proof_reason: null,
    proof_text: evidence.text, proof_photo_path: photoPath, result: null,
  }).eq("id", id).eq("status", "claimed").eq("claim_token_hash", tokenHash).select("id").maybeSingle();
  if (reserveError || !reserved) {
    await removePhoto(db, photoPath);
    if (reserveError) throw unavailable("Proof verification could not be started.");
    throw new ActionTaskError("Proof verification is already in progress.", 409);
  }
  const resetPending = async () => {
    const { data, error } = await db.from("action_tasks").update({
      status: "claimed", proof_status: row.proof_status, proof_reason: row.proof_reason,
      proof_text: row.proof_text, proof_photo_path: row.proof_photo_path, result: null,
    }).eq("id", id).eq("status", "verifying").eq("proof_status", "pending")
      .eq("claim_token_hash", tokenHash).select("id").maybeSingle();
    if (error) throw unavailable("Verification failed and the claim could not be reset.");
    if (data) await removePhoto(db, photoPath);
  };
  let verdict;
  try { verdict = await verifyActionProof(row, evidence); }
  catch {
    await resetPending();
    throw unavailable("Proof verification is unavailable. Your claim is retained; retry proof submission.");
  }
  const { data: saved, error: saveError } = await db.from("action_tasks").update({
    status: verdict.accepted ? "verifying" : "claimed",
    proof_status: verdict.accepted ? "accepted" : "rejected", proof_reason: verdict.reason,
    result: verdict.accepted ? { summary: verdict.summary, proof_text: evidence.text } : null,
  }).eq("id", id).eq("status", "verifying").eq("proof_status", "pending")
    .eq("claim_token_hash", tokenHash).select("*").maybeSingle();
  if (saveError || !saved) {
    await resetPending();
    throw unavailable("Proof verdict could not be saved. Your claim is retained; retry submission.");
  }
  if (row.proof_photo_path && row.proof_photo_path !== photoPath) await removePhoto(db, row.proof_photo_path);
  const finalRow = verdict.accepted ? await finalizeAccepted(db, saved as ActionTaskRow) : saved as ActionTaskRow;
  return { accepted: verdict.accepted, reason: verdict.reason, task: await publicView(db, finalRow) };
}
