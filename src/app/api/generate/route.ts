import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUsage } from "@/lib/plan";

/**
 * ============================================================================
 * THIS IS THE FILE YOU EDIT. Everything else is plumbing that already works.
 *
 * To make this your idea, change three things and nothing else:
 *   1. OutputSchema  — the shape you want back
 *   2. SYSTEM        — the rules the model follows
 *   3. the user message below
 *
 * Keep them in sync with src/lib/types.ts and the UI in src/app/dashboard/.
 * ============================================================================
 */

const RequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  input: z.string().trim().min(1).max(4000),
});

// 1. WHAT YOU WANT BACK. .describe() is not decoration — the model reads it,
//    so it's the cheapest place to steer output quality.
const OutputSchema = z.object({
  summary: z.string().describe("One sentence. What this is, in plain language."),
  tags: z.array(z.string()).max(5).describe("Up to five short labels."),
  result: z.string().describe("The actual useful output for the user."),
});

// 2. THE RULES. Be specific about what it must NOT do — that's usually what
//    separates a demo that impresses from one that embarrasses you on stage.
const SYSTEM = `You are a helpful assistant inside a product.

Rules:
- Be concrete and brief. No preamble, no restating the question.
- Never invent a fact, a number, a price, or a date. If you don't know,
  say what you'd need to know instead of guessing.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing title or input." }, { status: 400 });
  }

  // Quota is enforced here, on the server, before the model call. The client
  // also hides the button, but that's cosmetic — this is the check that counts,
  // and it's what stops a free account spending your API budget from the console.
  const usage = await getUsage(supabase, user.id);
  if (usage.remaining !== null && usage.remaining <= 0) {
    return NextResponse.json(
      { error: "Out of free runs this month.", upgrade: true },
      { status: 402 },
    );
  }

  const { title, input } = parsed.data;

  let output;
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4000,
      system: SYSTEM,
      // Thinking on, effort low: good judgment without paying for deep
      // reasoning on a small task. Raise effort to "high" if quality matters
      // more than cost or latency.
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      // 3. THE PROMPT.
      messages: [{ role: "user", content: `${title}\n\n${input}` }],
    });

    if (!response.parsed_output) {
      return NextResponse.json({ error: "No usable output. Try again." }, { status: 502 });
    }
    output = response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY missing or invalid." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited. Try again shortly." }, { status: 429 });
    }
    console.error("generate failed", error);
    return NextResponse.json({ error: "Generation failed." }, { status: 502 });
  }

  const { data: row, error: insertError } = await supabase
    .from("items")
    .insert({ user_id: user.id, title, input, output })
    .select()
    .single();

  if (insertError) {
    console.error("insert failed", insertError);
    return NextResponse.json({ error: "Generated, but couldn't save it." }, { status: 500 });
  }

  return NextResponse.json({ item: row });
}
