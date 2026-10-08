\set ON_ERROR_STOP 1
select p.relname, pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_class p on p.oid=i.inhparent where p.relname in ('rollup_5m','rollup_1h','event','packet') group by 1;
-- setup: a site user with 20 projects via a group
insert into access.app_user(entra_oid,tenant_id,email) values ('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'u@x') on conflict do nothing;
insert into access.project_access(project_id,entra_group_id) select id,'22222222-2222-2222-2222-222222222222' from core.project order by name limit 20 on conflict do nothing;
select id as uid from access.app_user where email='u@x' \gset
select id as pid from core.project order by name limit 1 \gset
select a.id as aid from core.asset a order by external_id limit 1 \gset
analyze;
\timing on
\echo '=== Q1 portfolio list, all projects + asset counts (leadership)'
select p.id,p.name,p.state,p.latitude,p.longitude,count(a.id) assets from core.project p left join core.asset a on a.project_id=p.id and a.retired_at is null where p.retired_at is null group by p.id;
\echo '=== Q1b portfolio list scoped to the user (20 projects)'
select p.id,p.name,p.state from core.project p where p.id in (select access.user_project_ids(:'uid', array['22222222-2222-2222-2222-222222222222']::uuid[]));
\echo '=== Q2 project page: all assets with live status, location, latest values'
select asset_id,name,asset_type,status_display,last_packet_at,latitude,longitude from core.v_asset_live where project_id=:'pid';
\echo '=== Q3 info box 2 counts'
select * from core.v_project_asset_counts where project_id=:'pid';
\echo '=== Q4 asset search across 5,000 assets: name contains "TC-01"'
select id,name from core.asset where name ilike '%TO-01%' limit 50;
\echo '=== Q5a trend 6 h raw, one parameter'
select ts, values->'p001' from telemetry.packet where asset_id=:'aid' and ts >= now()-interval '6 hours' and ts < now() order by ts;
\echo '=== Q5b trend 7 days from 5-min rollups'
select bucket, (stats->'p001'->>'avg')::numeric from telemetry.rollup_5m where asset_id=:'aid' and bucket >= now()-interval '7 days' order by bucket;
\echo '=== Q5c trend 90 days from hourly rollups'
select bucket, (stats->'p001'->>'avg')::numeric from telemetry.rollup_1h where asset_id=:'aid' and bucket >= now()-interval '90 days' order by bucket;
\echo '=== Q5d trend 3 years from daily rollups'
select bucket, (stats->'p001'->>'avg')::numeric from telemetry.rollup_1d where asset_id=:'aid' and bucket >= now()-interval '3 years' order by bucket;
\echo '=== Q6 explorer: 10 assets x 30 days hourly, min/avg/max'
select asset_id, min((stats->'p001'->>'min')::numeric), avg((stats->'p001'->>'avg')::numeric), max((stats->'p001'->>'max')::numeric)
from telemetry.rollup_1h where asset_id in (select id from core.asset order by external_id limit 10) and bucket >= now()-interval '30 days' group by asset_id;
\echo '=== Q7a events: latest 50 for a project (1M events)'
select id,occurred_at,title,severity from events.event where project_id=:'pid' order by occurred_at desc limit 50;
\echo '=== Q7b unread count for user over 20 projects, last 30 days'
select count(*) from events.event e where e.project_id in (select access.user_project_ids(:'uid', array['22222222-2222-2222-2222-222222222222']::uuid[])) and e.occurred_at >= now()-interval '30 days' and not exists (select 1 from events.event_read r where r.user_id=:'uid' and r.event_id=e.id);
\echo '=== Q8 energy box: sum of a parameter over generators in a project'
select count(*) gens, sum((lp.values->>'p010')::numeric) from core.asset a join core.asset_type t on t.id=a.asset_type_id join telemetry.latest_packet lp on lp.asset_id=a.id where a.project_id=:'pid' and t.category='energy';
\echo '=== Q9 one poll write: 300 packets + 300 latest upserts'
begin;
insert into telemetry.packet(asset_id,ts,values) select asset_id, ts + interval '1 minute', values from telemetry.latest_packet on conflict do nothing;
insert into telemetry.latest_packet(asset_id,ts,values) select asset_id, ts + interval '1 minute', values from telemetry.latest_packet
on conflict (asset_id) do update set ts=excluded.ts, values=excluded.values, received_at=now() where excluded.ts > telemetry.latest_packet.ts;
rollback;
