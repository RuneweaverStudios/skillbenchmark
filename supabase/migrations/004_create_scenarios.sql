CREATE TABLE public.scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    benchmark_run_id UUID NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'token_efficiency', 'task_completion', 'quality_preservation', 'stress_test'
    )),

    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    tools_json JSONB NOT NULL DEFAULT '[]',
    success_criteria JSONB NOT NULL DEFAULT '{}',
    expected_tool_calls INTEGER,
    max_turns INTEGER NOT NULL DEFAULT 20,

    generation_model TEXT NOT NULL,
    generation_prompt TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scenarios_skill ON public.scenarios(skill_id);
CREATE INDEX idx_scenarios_run ON public.scenarios(benchmark_run_id);

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY scenarios_read ON public.scenarios
    FOR SELECT USING (true);

CREATE POLICY scenarios_service ON public.scenarios
    FOR ALL USING (true);
