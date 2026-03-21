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
