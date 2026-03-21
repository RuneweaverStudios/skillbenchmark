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
