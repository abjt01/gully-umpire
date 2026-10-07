import NewMatch from "@/components/NewMatch";

export const metadata = { title: "New match · Gully Umpire" };

export default function NewMatchPage() {
  return (
    <main className="wrap">
      <section className="hero">
        <p className="eyebrow">New match</p>
        <h1>Who&apos;s playing?</h1>
      </section>
      <NewMatch />
    </main>
  );
}
