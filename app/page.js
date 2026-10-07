import Link from "next/link";
import RecentMatches from "@/components/RecentMatches";

export default function Home() {
  return (
    <main className="wrap">
      <section className="hero">
        <p className="eyebrow">Street cricket, scored by voice</p>
        <h1>Shout the score. Keep the phone in your pocket.</h1>
        <p className="lede">
          Someone yells &ldquo;four!&rdquo; or &ldquo;out, caught by Rohan!&rdquo; and Gully Umpire keeps the scorecard,
          says the score back out loud, and plays commentator after the big moments. It knows your lane&apos;s rules too:
          over the wall is out, one tip one hand, last man stands.
        </p>
        <Link className="btn primary" href="/new">
          Start a match
        </Link>
      </section>

      <RecentMatches />

      <section className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <b>Set up in a minute.</b> Team names, overs, and your lane&apos;s rules in plain words. Names are optional.
          </li>
          <li>
            <b>Put the phone down.</b> On a brick near the stumps is fine. Whoever&apos;s scoring holds the big button and
            shouts the ball: &ldquo;dot&rdquo;, &ldquo;chauka&rdquo;, &ldquo;wide&rdquo;, &ldquo;run out&rdquo;.
          </li>
          <li>
            <b>Listen, don&apos;t look.</b> It says the score back after every ball, and the commentator chimes in after
            wickets, boundaries and overs.
          </li>
          <li>
            <b>Share it.</b> Friends who couldn&apos;t make it follow a live link, and at the end you get a match report
            for the group chat.
          </li>
        </ol>
      </section>
    </main>
  );
}
