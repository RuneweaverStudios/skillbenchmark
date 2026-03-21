CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE public.benchmark_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL DEFAULT 1,
    status run_status NOT NULL DEFAULT 'pending',
    triggered_by UUID REFERENCES public.profiles(id),

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,

    total_scenarios INTEGER DEFAULT 0,
    completed_scenarios INTEGER DEFAULT 0,
    total_executions INTEGER DEFAULT 0,
    completed_executions INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(skill_id, run_number)
);

CREATE INDEX idx_benchmark_runs_skill ON public.benchmark_runs(skill_id);

ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY benchmark_runs_read ON public.benchmark_runs
    FOR SELECT USING (true);

CREATE POLICY benchmark_runs_service ON public.benchmark_runs
    FOR ALL USING (true);
