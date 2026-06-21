import "./globals.css";
import "@mysten/dapp-kit/dist/index.css";
import type { Metadata } from "next";
import { Anton, DM_Sans, Space_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clearinghouse",
  description: "Atomic, predicate-gated settlement for teams of AI agents on Sui",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${spaceMono.variable} ${dmSans.variable}`}>
      <body className="min-h-screen">
        <div className="crop-frame" aria-hidden>
          <span className="crop-mark crop-tl" />
          <span className="crop-mark crop-tr" />
          <span className="crop-mark crop-bl" />
          <span className="crop-mark crop-br" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
