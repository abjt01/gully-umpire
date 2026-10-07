import { modelInfo } from "@/lib/umpire";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(modelInfo());
}
