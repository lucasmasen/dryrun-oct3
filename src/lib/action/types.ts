import { z } from "zod";

export const ActionStatusSchema = z.enum([
  "awaiting_funding", "open", "claimed", "verifying", "completed",
]);
export const ProofTypeSchema = z.enum(["text", "photo"]);
export const ActionFundingStatusSchema = z.enum(["unfunded", "held", "captured"]);
export const ActionTaskIdSchema = z.string().uuid();
export const ClaimTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ActionProofTextSchema = z.string().trim().min(3).max(4000);

const cents = z.number().int().min(0).max(100000);
export const CreateActionTaskSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  proof_type: ProofTypeSchema,
  proof_instructions: z.string().trim().min(3).max(4000),
  purchase_allowance_cents: cents,
  worker_reward_cents: cents,
}).strict().superRefine((input, ctx) => {
  const total = input.purchase_allowance_cents + input.worker_reward_cents;
  if (total > 100000 || (total > 0 && total < 50)) {
    ctx.addIssue({ code: "custom", message: "Total must be zero or 50–100000 USD cents." });
  }
});

export const ClaimActionTaskSchema = z.object({
  device_id: z.string().trim().min(8).max(200),
}).strict();

export const ActionProofViewSchema = z.object({
  text: ActionProofTextSchema.nullable(),
  photo_url: z.string().url().nullable(),
  status: z.enum(["pending", "accepted", "rejected"]),
  reason: z.string().nullable(),
}).strict();

export const ActionResultSchema = z.object({
  summary: z.string().min(1).max(4000),
  proof_text: ActionProofTextSchema.nullable(),
  photo_url: z.string().url().nullable(),
}).strict();

export const ActionTaskViewSchema = z.object({
  id: ActionTaskIdSchema,
  prompt: z.string(),
  proof_type: ProofTypeSchema,
  proof_instructions: z.string(),
  purchase_allowance_cents: cents,
  worker_reward_cents: cents,
  total_cents: cents,
  status: ActionStatusSchema,
  created_at: z.string().datetime({ offset: true }),
  proof: ActionProofViewSchema.nullable(),
  result: ActionResultSchema.nullable(),
  funding: z.object({
    status: ActionFundingStatusSchema,
    checkout_url: z.string().url().nullable(),
  }).strict().nullable(),
}).strict();

export type ActionStatus = z.infer<typeof ActionStatusSchema>;
export type ProofType = z.infer<typeof ProofTypeSchema>;
export type ActionTaskView = z.infer<typeof ActionTaskViewSchema>;
export type CreateActionTaskInput = z.infer<typeof CreateActionTaskSchema>;
export type ClaimActionTaskInput = z.infer<typeof ClaimActionTaskSchema>;
export type ClaimActionTaskReceipt = { claim_token: string; task: ActionTaskView };
export type SubmitActionProofReceipt = { accepted: boolean; reason: string; task: ActionTaskView };
