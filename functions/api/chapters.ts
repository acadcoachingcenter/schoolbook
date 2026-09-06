import type { Env } from "../_lib/env";
import { jsonResponse, errorResponse } from "../_lib/env";
import subjectsData from "../../data/subjects.json";
import type { Subject } from "../../src/types";

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subject");

  if (!subjectId) return errorResponse("Missing required 'subject' query parameter.", 400, origin);

  const subject = (subjectsData as Subject[]).find((s) => s.id === subjectId);
  if (!subject) return errorResponse(`Unknown subject '${subjectId}'.`, 404, origin);

  return jsonResponse(subject.chapters, { status: 200 }, origin);
};
