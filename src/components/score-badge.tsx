import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  readonly score: number;
  readonly label: string;
  readonly size?: "sm" | "lg";
}

function getScoreColor(score: number): {
  ring: string;
  text: string;
  bg: string;
} {
  if (score >= 80) {
    return {
      ring: "border-emerald-500/40",
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
    };
  }
  if (score >= 60) {
    return {
      ring: "border-yellow-500/40",
      text: "text-yellow-400",
      bg: "bg-yellow-500/10",
    };
  }
  if (score >= 40) {
    return {
      ring: "border-orange-500/40",
      text: "text-orange-400",
      bg: "bg-orange-500/10",
    };
  }
  return {
    ring: "border-red-500/40",
    text: "text-red-400",
    bg: "bg-red-500/10",
  };
}

export function ScoreBadge({ score, label, size = "sm" }: ScoreBadgeProps) {
  const color = getScoreColor(score);
  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));

  const dimensions = size === "lg" ? "size-24" : "size-16";
  const scoreTextSize = size === "lg" ? "text-2xl" : "text-base";
  const labelTextSize = size === "lg" ? "text-sm" : "text-xs";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full border-2",
          dimensions,
          color.ring,
          color.bg
        )}
      >
        {/* Background track */}
        <svg
          className="absolute inset-0 size-full -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-muted/30"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray={`${clampedScore * 2.64} ${(100 - clampedScore) * 2.64}`}
            strokeLinecap="round"
            className={color.text}
          />
        </svg>
        <span
          className={cn(
            "relative z-10 font-semibold tabular-nums",
            scoreTextSize,
            color.text
          )}
        >
          {clampedScore}
        </span>
      </div>
      <span
        className={cn(
          "text-center font-medium text-muted-foreground",
          labelTextSize
        )}
      >
        {label}
      </span>
    </div>
  );
}
