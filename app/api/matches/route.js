import { createMatch } from "@/lib/matches";
import { rateLimit, readBody, route } from "@/lib/http";

export const POST = route(async (req) => {
  rateLimit(req, "create", 30, 60 * 60 * 1000);
  return Response.json(await createMatch(await readBody(req)), { status: 201 });
});
