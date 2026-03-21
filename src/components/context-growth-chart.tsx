"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TurnData {
  readonly turn: number;
  readonly baseline: number;
  readonly withSkill: number;
}

interface ContextGrowthChartProps {
  readonly data: readonly TurnData[];
  readonly title?: string;
}

export function ContextGrowthChart({
  data,
  title = "Context Growth Over Turns",
}: ContextGrowthChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No turn-level data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxTokens = Math.max(...data.flatMap((d) => [d.baseline, d.withSkill]));
  const formatted = formatTokenLabel(maxTokens);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data as TurnData[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="turn"
              label={{ value: "Turn", position: "insideBottom", offset: -5 }}
              stroke="#888"
            />
            <YAxis
              tickFormatter={(v: number) => formatTokenLabel(v)}
              stroke="#888"
              label={{
                value: "Context Tokens",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: "8px",
              }}
              formatter={(value: unknown, name: unknown) => [
                `${formatTokenLabel(Number(value))} tokens`,
                String(name) === "baseline" ? "Without Skill" : "With Skill",
              ]}
            />
            <Legend
              formatter={(value: string) =>
                value === "baseline" ? "Without Skill" : "With Skill"
              }
            />
            <Line
              type="monotone"
              dataKey="baseline"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 5"
            />
            <Line
              type="monotone"
              dataKey="withSkill"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {maxTokens > 0 && (
          <div className="mt-4 flex justify-between text-xs text-muted-foreground">
            <span>
              Peak baseline: {formatTokenLabel(Math.max(...data.map((d) => d.baseline)))}
            </span>
            <span>
              Peak with skill: {formatTokenLabel(Math.max(...data.map((d) => d.withSkill)))}
            </span>
            <span>
              Reduction:{" "}
              {Math.round(
                ((Math.max(...data.map((d) => d.baseline)) -
                  Math.max(...data.map((d) => d.withSkill))) /
                  Math.max(1, Math.max(...data.map((d) => d.baseline)))) *
                  100
              )}
              %
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatTokenLabel(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * Build chart data from execution turn metrics.
 * Pairs baseline and with-skill runs by turn number.
 */
export function buildChartData(
  baselineTurns: readonly { turn_number: number; context_chars: number }[],
  skillTurns: readonly { turn_number: number; context_chars: number }[]
): TurnData[] {
  const maxTurn = Math.max(
    ...baselineTurns.map((t) => t.turn_number),
    ...skillTurns.map((t) => t.turn_number),
    0
  );

  const baselineMap = new Map(baselineTurns.map((t) => [t.turn_number, t.context_chars]));
  const skillMap = new Map(skillTurns.map((t) => [t.turn_number, t.context_chars]));

  const data: TurnData[] = [];
  let lastBaseline = 0;
  let lastSkill = 0;

  for (let turn = 0; turn <= maxTurn; turn++) {
    lastBaseline = baselineMap.get(turn) ?? lastBaseline;
    lastSkill = skillMap.get(turn) ?? lastSkill;
    data.push({
      turn,
      baseline: Math.round(lastBaseline / 4), // chars to tokens estimate
      withSkill: Math.round(lastSkill / 4),
    });
  }

  return data;
}
