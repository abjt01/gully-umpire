import { addBall, callBall, commentary, report, undo, voiceBall } from "@/lib/matches";
import { HttpError, creds, rateLimit, readBody, route } from "@/lib/http";

const actions = {
  ball: (id, k, body) => addBall(id, k, body),
  call: (id, k, body) => callBall(id, k, body),
  undo: (id, k) => undo(id, k),
  commentary: (id, k, body) => commentary(id, k, body),
  report: (id, k) => report(id, k),
};

export const POST = route(async (req, { params }) => {
  const { id, action } = await params;
  const { k } = creds(req);
  rateLimit(req, "score", 300, 10 * 60 * 1000);

  if (action === "voice") {
    let form;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "No audio came through.");
    }
    return Response.json(await voiceBall(id, k, form.get("audio")));
  }
  const run = actions[action];
  if (!run) throw new HttpError(404, "Not found.");
  return Response.json(await run(id, k, await readBody(req)));
});
