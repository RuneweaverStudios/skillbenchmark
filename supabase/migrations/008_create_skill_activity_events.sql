CREATE TABLE public.skill_activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,       -- 'status_change', 'progress', 'info', 'error'
    stage TEXT NOT NULL,            -- 'cloning', 'parsing', 'generating_scenarios', 'benchmarking', 'scoring'
    message TEXT NOT NULL,          -- human-readable description
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index: equality on skill_id first, then range/order on created_at
CREATE INDEX idx_skill_activity_events_skill ON public.skill_activity_events(skill_id, created_at);

ALTER TABLE public.skill_activity_events ENABLE ROW LEVEL SECURITY;

-- Anyone can read activity events (public alongside the parent skill)
CREATE POLICY skill_activity_events_read ON public.skill_activity_events
    FOR SELECT USING (true);

-- Only the service_role may insert (worker inserts via service key)
-- The service_role bypasses RLS by default, so this policy is a defence-in-depth
-- guard that prevents authenticated/anon roles from writing rows directly.
CREATE POLICY skill_activity_events_insert ON public.skill_activity_events
    FOR INSERT TO service_role WITH CHECK (true);
