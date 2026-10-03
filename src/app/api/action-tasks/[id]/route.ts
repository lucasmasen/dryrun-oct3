import { actionTaskErrorResponse, actionTaskResponse, getActionTask } from "@/lib/action/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return actionTaskResponse(await getActionTask(id));
  } catch (error) { return actionTaskErrorResponse(error); }
}
