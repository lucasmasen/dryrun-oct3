import {
  actionTaskErrorResponse, actionTaskResponse, claimActionTask, readActionJson,
} from "@/lib/action/tasks";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return actionTaskResponse(await claimActionTask(id, await readActionJson(request)));
  } catch (error) { return actionTaskErrorResponse(error); }
}
