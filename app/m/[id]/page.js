import MatchRoom from "@/components/MatchRoom";
import { getMatch } from "@/lib/matches";

// Shows up in the WhatsApp preview when someone shares the live link.
export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const m = await getMatch(id);
    const [a, b] = m.setup.teams.map((t) => t.name);
    return {
      title: `${a} vs ${b} · Gully Umpire`,
      description: m.result ? m.result.text : "Live gully cricket score, called by voice.",
    };
  } catch {
    return { title: "Gully Umpire" };
  }
}

export default async function MatchPage({ params, searchParams }) {
  const { id } = await params;
  const { k = "" } = await searchParams;
  return (
    <main className="wrap">
      <MatchRoom id={id} k={String(k)} />
    </main>
  );
}
