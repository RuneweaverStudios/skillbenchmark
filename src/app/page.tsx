import Link from "next/link";
import {
  ArrowRight,
  GitBranch,
  Zap,
  Trophy,
  Brain,
  TestTubes,
  BarChart3,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

// ── Mock Data ──

const leaderboardData = [
  {
    rank: 1,
    name: "commit-wizard",
    author: "RuneweaverStudios",
    score: 94.2,
    category: "Git",
    models: 5,
    trend: "+2.1",
  },
  {
    rank: 2,
    name: "test-generator-pro",
    author: "devcraft",
    score: 91.8,
    category: "Testing",
    models: 5,
    trend: "+0.4",
  },
  {
    rank: 3,
    name: "refactor-engine",
    author: "codesmith",
    score: 89.5,
    category: "Refactoring",
    models: 4,
    trend: "-0.3",
  },
  {
    rank: 4,
    name: "doc-autowriter",
    author: "opensrc",
    score: 87.1,
    category: "Docs",
    models: 5,
    trend: "+1.7",
  },
  {
    rank: 5,
    name: "debug-detective",
    author: "bugslayer",
    score: 85.6,
    category: "Debugging",
    models: 3,
    trend: "+0.9",
  },
] as const;

const steps = [
  {
    icon: GitBranch,
    title: "Submit GitHub URL",
    description:
      "Point us to your SKILL.md file or repository. We parse skill metadata automatically.",
  },
  {
    icon: Brain,
    title: "AI Generates Benchmarks",
    description:
      "Our system creates targeted test scenarios that probe the skill's capabilities and edge cases.",
  },
  {
    icon: TestTubes,
    title: "Multi-Agent Testing",
    description:
      "Multiple AI models run your skill through structured agent loops, scoring each execution.",
  },
  {
    icon: BarChart3,
    title: "Get Your Score",
    description:
      "View detailed results, model-by-model breakdowns, and your position on the leaderboard.",
  },
] as const;

const stats = [
  { value: "100+", label: "Skills Benchmarked" },
  { value: "5", label: "AI Models" },
  { value: "3", label: "Agent Loops" },
] as const;

// ── Category badge variant mapping ──

function categoryVariant(category: string) {
  switch (category) {
    case "Git":
      return "default" as const;
    case "Testing":
      return "secondary" as const;
    case "Refactoring":
      return "outline" as const;
    case "Docs":
      return "secondary" as const;
    case "Debugging":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

// ── Page ──

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden border-b border-border/50">
        {/* Background gradient glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

        <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-8 px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
          <Badge variant="outline" className="gap-1.5">
            <Zap className="size-3" />
            Open-source skill benchmarking
          </Badge>

          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Benchmark Any Skill.{" "}
            <span className="text-primary">Prove It Works.</span>
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Submit your Claude Code skills, let AI generate rigorous benchmarks,
            and see how they perform across multiple models and agent loops.
            Data-driven quality for the skill ecosystem.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/submit">
              <Button size="lg" className="gap-2 px-6 text-sm font-semibold">
                Submit a Skill
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/leaderboard">
              <Button variant="outline" size="lg" className="gap-2 px-6 text-sm">
                <Trophy className="size-4" />
                View Leaderboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats Section ── */}
      <section className="border-b border-border/50 bg-muted/30">
        <div className="mx-auto grid max-w-4xl grid-cols-3 divide-x divide-border/50 px-4 py-10 sm:px-6 lg:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1 px-4">
              <span className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {stat.value}
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="border-b border-border/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              How It Works
            </h2>
            <p className="mt-3 text-muted-foreground">
              Four steps from submission to score
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <Card key={step.title} className="relative">
                  <CardHeader>
                    <div className="mb-2 flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        Step {index + 1}
                      </span>
                    </div>
                    <CardTitle>{step.title}</CardTitle>
                    <CardDescription>{step.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Featured on the Leaderboard ── */}
      <section className="border-b border-border/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Featured on the Leaderboard
              </h2>
              <p className="mt-2 text-muted-foreground">
                Top-performing skills ranked by composite benchmark score
              </p>
            </div>
            <Link href="/leaderboard">
              <Button variant="outline" size="sm" className="gap-1.5">
                View all
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 pl-4">#</TableHead>
                    <TableHead>Skill</TableHead>
                    <TableHead className="hidden sm:table-cell">Author</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden lg:table-cell">Models</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="w-16 pr-4 text-right">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboardData.map((skill) => (
                    <TableRow key={skill.name}>
                      <TableCell className="pl-4 font-medium">
                        {skill.rank === 1 ? (
                          <Trophy className="size-4 text-yellow-500" />
                        ) : skill.rank === 2 ? (
                          <Trophy className="size-4 text-zinc-400" />
                        ) : skill.rank === 3 ? (
                          <Trophy className="size-4 text-amber-700" />
                        ) : (
                          <span className="text-muted-foreground">{skill.rank}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Star className="size-3.5 text-muted-foreground" />
                          <span className="font-medium text-foreground">
                            {skill.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {skill.author}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={categoryVariant(skill.category)}>
                          {skill.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {skill.models}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-foreground">
                        {skill.score}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <span
                          className={
                            skill.trend.startsWith("+")
                              ? "text-emerald-500"
                              : "text-red-400"
                          }
                        >
                          {skill.trend}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Ready to benchmark your skill?
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Join the community of developers building and testing Claude Code skills.
            Submit yours today and see how it stacks up.
          </p>
          <Link href="/submit">
            <Button size="lg" className="gap-2 px-6 text-sm font-semibold">
              Get Started
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
