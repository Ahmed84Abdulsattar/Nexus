\set ON_ERROR_STOP 1
\timing on
create temp table a300 as select id from core.asset order by external_id limit 300;
insert into telemetry.packet(asset_id,ts,values)
select a.id, t.ts,
  (select ('{' || string_agg(format('"p%s":%s', lpad(k::text,3,'0'), round((random()*1000)::numeric, 2)), ',') || '}')::jsonb
     from generate_series(1,103) k where t.ts is not null)
from a300 a
cross join generate_series(date_trunc('minute', now()) - interval '24 hours', date_trunc('minute', now()) - interval '1 minute', interval '1 minute') t(ts);
insert into telemetry.latest_packet(asset_id,ts,values)
select distinct on (asset_id) asset_id, ts, values from telemetry.packet order by asset_id, ts desc;
analyze;
select count(*) packets, pg_size_pretty(pg_total_relation_size('telemetry.packet_p'||to_char(current_date,'YYYYMMDD'))+pg_total_relation_size('telemetry.packet_p'||to_char(current_date-1,'YYYYMMDD'))) size_on_disk from telemetry.packet;
