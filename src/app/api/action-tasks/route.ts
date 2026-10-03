import {
  actionTaskErrorResponse, actionTaskResponse, createActionTask, listActionTasks, readActionJson,
} from "@/lib/action/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const task = await createActionTask(await readActionJson(request), new URL(request.url).origin);
    return actionTaskResponse(task, 201);
  } catch (error) { return actionTaskErrorResponse(error); }
}

export async function GET(request: Request) {
  try {
    return actionTaskResponse(await listActionTasks(new URL(request.url).searchParams.get("status")));
  } catch (error) { return actionTaskErrorResponse(error); }
}
