import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Github, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SkillBenchmark — Benchmark Any Claude Code Skill",
  description:
    "Submit, test, and rank Claude Code skills with multi-agent AI benchmarking. Built for the Claude Code community.",
};

const navLinks = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/submit", label: "Submit" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {/* ── Navigation ── */}
        <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
          <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
            >
              <Zap className="size-5 text-primary" />
              <span className="text-base">SkillBenchmark</span>
            </Link>

            {/* Center nav links — hidden on mobile, shown md+ */}
            <div className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  <Button variant="ghost" size="sm">
                    {link.label}
                  </Button>
                </Link>
              ))}
            </div>

            {/* Right section */}
            <div className="flex items-center gap-2">
              {/* Mobile nav links — visible below md */}
              <div className="flex items-center gap-1 md:hidden">
                {navLinks.map((link) => (
                  <Link key={link.href} href={link.href}>
                    <Button variant="ghost" size="xs">
                      {link.label}
                    </Button>
                  </Link>
                ))}
              </div>

              <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

              <Link href="/login">
                <Button variant="outline" size="sm">
                  <Github className="size-4" />
                  <span className="hidden sm:inline">Sign in</span>
                </Button>
              </Link>
            </div>
          </nav>
        </header>

        {/* ── Main Content ── */}
        <main className="flex flex-1 flex-col">{children}</main>

        {/* ── Footer ── */}
        <footer className="border-t border-border/50">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <p className="text-xs text-muted-foreground">
              Built for the Claude Code community
            </p>
            <div className="flex items-center gap-4">
              <Link
                href="https://github.com"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </Link>
              <Link
                href="/leaderboard"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Leaderboard
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
