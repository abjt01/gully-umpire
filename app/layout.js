import { Archivo, Inter } from "next/font/google";
import Link from "next/link";
import { modelInfo } from "@/lib/umpire";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gully Umpire",
  description: "Shout the ball, keep the phone in your pocket. Open-weight AI keeps score by your lane's rules and calls the commentary out loud.",
};

export const viewport = { themeColor: "#c8f031" };

export default function RootLayout({ children }) {
  const { mock, groq, ears, umpire } = modelInfo();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <header className="top">
          <Link className="brand" href="/">
            🏏 Gully Umpire
          </Link>
        </header>
        {children}
        <footer className="foot">
          <p>
            Ears: {ears}. Umpire: {umpire}. Open-weight models{groq ? ", served free on Groq." : "."} The scoring itself is
            plain code.
          </p>
          {mock && (
            <p>
              <span className="badge">No AI key</span> Buttons and simple typed calls still work.
            </p>
          )}
        </footer>
      </body>
    </html>
  );
}
