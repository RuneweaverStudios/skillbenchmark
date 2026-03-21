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
