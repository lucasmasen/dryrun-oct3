import {
  ActionTaskError, actionTaskErrorResponse, actionTaskResponse, submitActionProof,
} from "@/lib/action/tasks";
import { MAX_ACTION_PHOTO_BYTES } from "@/lib/action/proof";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      throw new ActionTaskError("Send multipart form data with claim_token and matching proof.", 400);
    }
    const length = request.headers.get("content-length");
    if (length && Number(length) > MAX_ACTION_PHOTO_BYTES + 65536) {
      throw new ActionTaskError("Proof request is too large. Photos must be at most 4 MB.", 413);
    }
    let form;
    try { form = await request.formData(); }
    catch { throw new ActionTaskError("Proof form could not be read.", 400); }
    return actionTaskResponse(await submitActionProof(id, form));
  } catch (error) { return actionTaskErrorResponse(error); }
}
