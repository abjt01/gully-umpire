import { previewRules } from "@/lib/matches";
import { rateLimit, readBody, route } from "@/lib/http";

export const POST = route(async (req) => {
  rateLimit(req, "rules", 60, 60 * 60 * 1000);
  return Response.json({ rules: await previewRules(await readBody(req)) });
});
