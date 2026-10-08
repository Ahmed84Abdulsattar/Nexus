\set ON_ERROR_STOP 1
\timing on
\echo '--- per-minute job: 5-min rollup over last 15 minutes (300 assets)'
select telemetry.refresh_rollup_5m(now()-interval '15 minutes', now());
\echo '--- per-minute job: 1-hour combine for current+previous hour'
select telemetry.refresh_rollup_5m(now()-interval '24 hours', now()) as full_day_5m;
select telemetry.refresh_rollup_combine('telemetry.rollup_5m','telemetry.rollup_1h','1 hour', date_trunc('hour',now())-interval '1 hour', now());
\echo '--- full day 1h + 1d'
select telemetry.refresh_rollup_combine('telemetry.rollup_5m','telemetry.rollup_1h','1 hour', now()-interval '25 hours', now());
select telemetry.refresh_rollup_combine('telemetry.rollup_1h','telemetry.rollup_1d','1 day', now()-interval '3 days', now()+interval '1 day','Asia/Dubai');
select pg_size_pretty(avg(pg_column_size(stats))) avg_5m_stats_bytes, count(*) from telemetry.rollup_5m;
