CREATE TYPE agent_loop_type AS ENUM ('hermes', 'claude_api', 'claude_cli');

CREATE TABLE public.executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
    benchmark_run_id UUID NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,

    model TEXT NOT NULL,
    agent_loop agent_loop_type NOT NULL,
    with_skill BOOLEAN NOT NULL,

    status run_status NOT NULL DEFAULT 'pending',

    container_id TEXT,
    docker_image TEXT,

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    wall_time_ms INTEGER,

    -- Token metrics
    total_prompt_tokens INTEGER,
    total_completion_tokens INTEGER,
    total_tokens INTEGER,

    -- Cost
    total_cost_usd NUMERIC(10,6),

    -- Task metrics
    task_completed BOOLEAN,
    completion_quality NUMERIC(5,2),
    total_tool_calls INTEGER,
    total_turns INTEGER,

    -- Context growth
    initial_context_tokens INTEGER,
    final_context_tokens INTEGER,
    peak_context_tokens INTEGER,

    -- Latency
    avg_turn_latency_ms INTEGER,
    p95_turn_latency_ms INTEGER,

    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_executions_scenario ON public.executions(scenario_id);
CREATE INDEX idx_executions_run ON public.executions(benchmark_run_id);
CREATE INDEX idx_executions_model ON public.executions(model);

ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY executions_read ON public.executions
    FOR SELECT USING (true);

CREATE POLICY executions_service ON public.executions
    FOR ALL USING (true);
