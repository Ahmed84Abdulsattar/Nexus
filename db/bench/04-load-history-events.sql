\set ON_ERROR_STOP 1
\timing on
select core.create_range_partitions('telemetry.rollup_5m','month', (current_date - 40), 2);
select core.create_range_partitions('telemetry.rollup_1h','month', (current_date - interval '7 months')::date, 8);
select core.create_range_partitions('events.event','month', (current_date - interval '6 months')::date, 7);
create temp table a300 as select id from core.asset order by external_id limit 300;
create temp table tpl5 as select stats from telemetry.rollup_5m limit 1;
create temp table tpl1h as select stats from telemetry.rollup_1h limit 1;
-- 5-min rollups: 7 days back (beyond the real day already there)
insert into telemetry.rollup_5m(asset_id,bucket,stats,packets)
select a.id, b, (select stats from tpl5), 5 from a300 a,
 generate_series(date_bin('5 minutes', now()-interval '8 days', '2000-01-01'::timestamptz), now()-interval '25 hours', interval '5 minutes') b
on conflict do nothing;
-- hourly: 180 days
insert into telemetry.rollup_1h(asset_id,bucket,stats,packets)
select a.id, b, (select stats from tpl1h), 60 from a300 a,
 generate_series(date_trunc('hour', now()-interval '180 days'), now()-interval '26 hours', interval '1 hour') b
on conflict do nothing;
-- daily: 3 years
insert into telemetry.rollup_1d(asset_id,bucket,stats,packets)
select a.id, b, (select stats from tpl1h), 1440 from a300 a,
 generate_series(date_trunc('day', now()-interval '3 years'), now()-interval '3 days', interval '1 day') b
on conflict do nothing;
-- events: ~1M over 6 months across all assets
insert into events.event(occurred_at,source_system,external_id,project_id,asset_id,category,severity,title,source_state)
select now() - random()*interval '180 days', 'datoms', 'e'||g, a.project_id, a.id,
  (array['alarm','fault','info','maintenance'])[1+g%4], (array['high','medium','low'])[1+g%3], 'Event '||g, 'active'
from generate_series(1,1000000) g
join lateral (select id, project_id from core.asset offset (g%5000) limit 1) a on true;
analyze;
select relname, pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_class p on p.oid=i.inhparent where p.relname in ('rollup_5m','rollup_1h','event','packet') group by 1;
select pg_size_pretty(pg_total_relation_size('telemetry.rollup_1d')) rollup_1d;
