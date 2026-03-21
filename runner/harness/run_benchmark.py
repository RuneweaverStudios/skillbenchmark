#!/usr/bin/env python3
"""
Benchmark runner harness — executes inside a Docker container.
Reads job config from /job/config.json, runs the benchmark,
writes results to /job/results.json.

Communication with the worker happens via filesystem IPC:
- Worker writes API responses to /job/responses/
- Harness writes tool call requests to /job/requests/
- Final results go to /job/results.json
"""

import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class TurnMetric:
    turn_number: int
    prompt_tokens: int
    completion_tokens: int
    context_chars: int
    latency_ms: int
    cost_usd: float
    tool_name: Optional[str]
    tool_result_raw_size: int
    tool_result_filtered_size: int


@dataclass(frozen=True)
class BenchmarkResult:
    task_completed: bool
    total_turns: int
    total_tool_calls: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_cost_usd: float
    initial_context_tokens: int
    final_context_tokens: int
    peak_context_tokens: int
    avg_turn_latency_ms: int
    p95_turn_latency_ms: int
    turn_metrics: list
    final_assistant_message: str
    error: Optional[str]


JOB_DIR = Path("/job")
CONFIG_PATH = JOB_DIR / "config.json"
RESULTS_PATH = JOB_DIR / "results.json"
REQUESTS_DIR = JOB_DIR / "requests"
RESPONSES_DIR = JOB_DIR / "responses"


def estimate_tokens(text: str) -> int:
    """Fast token estimate: ~4 chars per token."""
    return len(text) // 4


def p95(values: list[int]) -> int:
    """Calculate p95 latency."""
    if not values:
        return 0
    s = sorted(values)
    idx = max(0, int(0.95 * len(s)) - 1)
    return s[idx]


def run_benchmark(config: dict) -> BenchmarkResult:
    """Execute the benchmark scenario according to config."""
    agent_loop = config["agent_loop"]
    model = config["model"]
    system_prompt = config["system_prompt"]
    user_prompt = config["user_prompt"]
    tools = config.get("tools", [])
    max_turns = config.get("max_turns", 20)
    skill_content = config.get("skill_content")
    with_skill = config.get("with_skill", False)
    timeout_ms = config.get("timeout_ms", 300_000)

    # Inject skill into system prompt if enabled
    if with_skill and skill_content:
        system_prompt = f"{system_prompt}\n\n---\n\n# Skill Instructions\n\n{skill_content}"

    turn_metrics: list[TurnMetric] = []
    total_tool_calls = 0
    peak_context = 0
    final_message = ""
    error = None

    context_chars = len(system_prompt) + len(user_prompt) + len(json.dumps(tools))
    initial_tokens = estimate_tokens(
        system_prompt + user_prompt + json.dumps(tools)
    )

    start_time = time.time()
    deadline = start_time + (timeout_ms / 1000)

    try:
        for turn in range(max_turns):
            if time.time() > deadline:
                error = "Timeout exceeded"
                break

            turn_start = time.time()

            # Write request for worker to process via API
            request = {
                "turn": turn,
                "model": model,
                "agent_loop": agent_loop,
                "context_chars": context_chars,
            }

            request_path = REQUESTS_DIR / f"turn_{turn:03d}.json"
            request_path.write_text(json.dumps(request))

            # Wait for response from worker
            response_path = RESPONSES_DIR / f"turn_{turn:03d}.json"
            while not response_path.exists():
                if time.time() > deadline:
                    error = "Timeout waiting for API response"
                    break
                time.sleep(0.1)

            if error:
                break

            response = json.loads(response_path.read_text())
            latency_ms = int((time.time() - turn_start) * 1000)

            prompt_tokens = response.get("usage", {}).get("prompt_tokens", 0)
            completion_tokens = response.get("usage", {}).get("completion_tokens", 0)

            # Check for tool calls
            tool_calls = response.get("tool_calls", [])
            if tool_calls:
                for tc in tool_calls:
                    total_tool_calls += 1
                    tool_result_size = len(json.dumps(tc.get("result", "")))
                    context_chars += tool_result_size

                    turn_metrics.append(TurnMetric(
                        turn_number=turn,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        context_chars=context_chars,
                        latency_ms=latency_ms,
                        cost_usd=response.get("cost_usd", 0),
                        tool_name=tc.get("name"),
                        tool_result_raw_size=tool_result_size,
                        tool_result_filtered_size=tool_result_size,
                    ))
            else:
                final_message = response.get("content", "")
                context_chars += len(final_message)

                turn_metrics.append(TurnMetric(
                    turn_number=turn,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    context_chars=context_chars,
                    latency_ms=latency_ms,
                    cost_usd=response.get("cost_usd", 0),
                    tool_name=None,
                    tool_result_raw_size=0,
                    tool_result_filtered_size=0,
                ))

                if response.get("finish_reason") == "stop":
                    break

            peak_context = max(peak_context, context_chars)

    except Exception as e:
        error = str(e)

    latencies = [m.latency_ms for m in turn_metrics]
    final_tokens = estimate_tokens(str(context_chars))

    return BenchmarkResult(
        task_completed=error is None and len(final_message) > 0,
        total_turns=len(turn_metrics),
        total_tool_calls=total_tool_calls,
        total_prompt_tokens=sum(m.prompt_tokens for m in turn_metrics),
        total_completion_tokens=sum(m.completion_tokens for m in turn_metrics),
        total_cost_usd=sum(m.cost_usd for m in turn_metrics),
        initial_context_tokens=initial_tokens,
        final_context_tokens=final_tokens,
        peak_context_tokens=max(peak_context, final_tokens),
        avg_turn_latency_ms=int(sum(latencies) / max(1, len(latencies))),
        p95_turn_latency_ms=p95(latencies),
        turn_metrics=[asdict(m) for m in turn_metrics],
        final_assistant_message=final_message,
        error=error,
    )


def main():
    """Entry point: read config, run benchmark, write results."""
    if not CONFIG_PATH.exists():
        print(f"Error: {CONFIG_PATH} not found", file=sys.stderr)
        sys.exit(1)

    # Ensure IPC directories exist
    REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
    RESPONSES_DIR.mkdir(parents=True, exist_ok=True)

    config = json.loads(CONFIG_PATH.read_text())
    print(f"Running benchmark: {config.get('scenario_name', 'unknown')}")
    print(f"  Model: {config['model']}")
    print(f"  Agent loop: {config['agent_loop']}")
    print(f"  With skill: {config.get('with_skill', False)}")

    result = run_benchmark(config)

    RESULTS_PATH.write_text(json.dumps(asdict(result), indent=2))
    print(f"Results written to {RESULTS_PATH}")
    print(f"  Task completed: {result.task_completed}")
    print(f"  Total turns: {result.total_turns}")
    print(f"  Total tool calls: {result.total_tool_calls}")

    sys.exit(0 if result.task_completed else 1)


if __name__ == "__main__":
    main()
