"""
Per-turn metric collection for benchmark runs.
Tracks tokens, latency, context size, and tool call details.
"""

import time
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass(frozen=True)
class TurnMetric:
    turn_number: int
    prompt_tokens: int
    completion_tokens: int
    context_chars: int
    latency_ms: int
    cost_usd: float = 0.0
    tool_name: Optional[str] = None
    tool_result_raw_size: int = 0
    tool_result_filtered_size: int = 0


@dataclass
class MetricsCollector:
    """Collects per-turn metrics during a benchmark run."""

    metrics: list[TurnMetric] = field(default_factory=list)
    _start_time: float = field(default_factory=time.time)

    def record_turn(
        self,
        turn_number: int,
        prompt_tokens: int,
        completion_tokens: int,
        context_chars: int,
        latency_ms: int,
        cost_usd: float = 0.0,
        tool_name: Optional[str] = None,
        tool_result_raw_size: int = 0,
        tool_result_filtered_size: int = 0,
    ) -> None:
        self.metrics.append(TurnMetric(
            turn_number=turn_number,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            context_chars=context_chars,
            latency_ms=latency_ms,
            cost_usd=cost_usd,
            tool_name=tool_name,
            tool_result_raw_size=tool_result_raw_size,
            tool_result_filtered_size=tool_result_filtered_size,
        ))

    @property
    def total_prompt_tokens(self) -> int:
        return sum(m.prompt_tokens for m in self.metrics)

    @property
    def total_completion_tokens(self) -> int:
        return sum(m.completion_tokens for m in self.metrics)

    @property
    def total_cost(self) -> float:
        return sum(m.cost_usd for m in self.metrics)

    @property
    def avg_latency_ms(self) -> int:
        if not self.metrics:
            return 0
        return int(sum(m.latency_ms for m in self.metrics) / len(self.metrics))

    @property
    def p95_latency_ms(self) -> int:
        if not self.metrics:
            return 0
        latencies = sorted(m.latency_ms for m in self.metrics)
        idx = max(0, int(0.95 * len(latencies)) - 1)
        return latencies[idx]

    @property
    def peak_context_chars(self) -> int:
        if not self.metrics:
            return 0
        return max(m.context_chars for m in self.metrics)

    @property
    def wall_time_ms(self) -> int:
        return int((time.time() - self._start_time) * 1000)

    def to_dict(self) -> dict:
        return {
            "metrics": [asdict(m) for m in self.metrics],
            "summary": {
                "total_turns": len(self.metrics),
                "total_prompt_tokens": self.total_prompt_tokens,
                "total_completion_tokens": self.total_completion_tokens,
                "total_cost_usd": self.total_cost,
                "avg_latency_ms": self.avg_latency_ms,
                "p95_latency_ms": self.p95_latency_ms,
                "peak_context_chars": self.peak_context_chars,
                "wall_time_ms": self.wall_time_ms,
            },
        }
