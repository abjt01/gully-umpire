import { getMatch } from "@/lib/matches";
import { creds, route } from "@/lib/http";

export const GET = route(async (req, { params }) => {
  const { id } = await params;
  return Response.json(await getMatch(id, creds(req).k), { headers: { "Cache-Control": "no-store" } });
});
