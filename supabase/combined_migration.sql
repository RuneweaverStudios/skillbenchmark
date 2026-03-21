-- 001_create_profiles.sql
-- Profiles table (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    github_username TEXT NOT NULL UNIQUE,
    avatar_url TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_read ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY profiles_insert ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update ON public.profiles
    FOR UPDATE USING (id = auth.uid());

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, github_username, avatar_url, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'user_name', NEW.raw_user_meta_data->>'preferred_username', 'user'),
        NEW.raw_user_meta_data->>'avatar_url',
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 002_create_skills.sql
CREATE TYPE skill_format AS ENUM ('claude_code', 'openclaw');
CREATE TYPE skill_status AS ENUM (
    'pending', 'cloning', 'parsing', 'generating_scenarios',
    'benchmarking', 'scoring', 'completed', 'failed'
);

CREATE TABLE public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_by UUID NOT NULL REFERENCES public.profiles(id),
    github_url TEXT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    skill_path TEXT,
    format skill_format NOT NULL,
    status skill_status NOT NULL DEFAULT 'pending',
    error_message TEXT,

    -- Parsed metadata
    name TEXT,
    display_name TEXT,
    description TEXT,
    version TEXT,
    author TEXT,
    tags TEXT[] DEFAULT '{}',
    raw_skill_content TEXT,

    -- Scores (populated after benchmarking)
    overall_score NUMERIC(5,2),
    token_efficiency_score NUMERIC(5,2),
    task_completion_score NUMERIC(5,2),
    quality_preservation_score NUMERIC(5,2),
    latency_impact_score NUMERIC(5,2),

    commit_sha TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(github_url, commit_sha)
);

CREATE INDEX idx_skills_status ON public.skills(status);
CREATE INDEX idx_skills_overall_score ON public.skills(overall_score DESC NULLS LAST);
CREATE INDEX idx_skills_submitted_by ON public.skills(submitted_by);

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY skills_read ON public.skills
    FOR SELECT USING (status = 'completed' OR submitted_by = auth.uid());

CREATE POLICY skills_insert ON public.skills
    FOR INSERT WITH CHECK (submitted_by = auth.uid());

-- Allow service role to update (worker process)
CREATE POLICY skills_update_service ON public.skills
    FOR UPDATE USING (true);


-- 003_create_benchmark_runs.sql
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


-- 004_create_scenarios.sql
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


-- 005_create_executions.sql
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


-- 006_create_turn_metrics.sql
CREATE TABLE public.turn_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,

    turn_number INTEGER NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    context_chars INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    cost_usd NUMERIC(10,6),

    tool_name TEXT,
    tool_result_raw_size INTEGER,
    tool_result_filtered_size INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_turn_metrics_execution ON public.turn_metrics(execution_id);

ALTER TABLE public.turn_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY turn_metrics_read ON public.turn_metrics
    FOR SELECT USING (true);

CREATE POLICY turn_metrics_service ON public.turn_metrics
    FOR ALL USING (true);


-- 007_create_leaderboard_view.sql
CREATE MATERIALIZED VIEW public.leaderboard AS
SELECT
    s.id AS skill_id,
    s.name,
    s.display_name,
    s.format,
    s.github_url,
    s.description,
    s.author,
    s.tags,
    s.overall_score,
    s.token_efficiency_score,
    s.task_completion_score,
    s.quality_preservation_score,
    s.latency_impact_score,
    p.github_username AS submitted_by,
    p.avatar_url,
    (
        SELECT COUNT(*)
        FROM public.benchmark_runs br
        WHERE br.skill_id = s.id AND br.status = 'completed'
    ) AS total_runs,
    s.updated_at AS last_benchmarked_at,
    RANK() OVER (ORDER BY s.overall_score DESC NULLS LAST) AS rank
FROM public.skills s
JOIN public.profiles p ON s.submitted_by = p.id
WHERE s.status = 'completed' AND s.overall_score IS NOT NULL
ORDER BY s.overall_score DESC NULLS LAST;

CREATE UNIQUE INDEX idx_leaderboard_skill ON public.leaderboard(skill_id);

-- Function to refresh leaderboard (called after scoring)
CREATE OR REPLACE FUNCTION public.refresh_leaderboard()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


