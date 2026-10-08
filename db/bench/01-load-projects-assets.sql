\set ON_ERROR_STOP 1
\timing on
-- 100 projects across 7 districts
insert into core.district(name,emirate) select 'District '||g, (array['Dubai','Abu Dhabi','Sharjah','Ajman','RAK','Fujairah','UAQ'])[1+g%7] from generate_series(1,7) g;
insert into core.project(name,state,district_id,latitude,longitude,source_system,external_id)
select 'Project '||lpad(g::text,3,'0'), (array['active','active','active','central_store','finished','in_bid'])[1+g%6],
  (select id from core.district order by name offset (g%7) limit 1), 24+random()*2, 54+random()*2,'datoms','site-'||g
from generate_series(1,100) g;
-- 5,000 assets (50 per project)
insert into core.asset(project_id,asset_type_id,name,make,model,serial_no,source_system,external_id,asset_info)
select p.id, t.id, initcap(replace(t.code,'_',' '))||' '||upper(left(t.code,2))||'-'||lpad(g::text,4,'0'),
  'Make'||(g%9),'Model'||(g%13),'SN'||g,'datoms',(30000+g)::text, jsonb_build_object('kva',250+g%500,'capacity','x')
from generate_series(1,5000) g
join lateral (select id from core.project order by name offset ((g-1)/50) limit 1) p on true
join lateral (select id,code from core.asset_type where code<>'generic' order by code offset (g%9) limit 1) t on true;
insert into telemetry.status_map values ('datoms','Running','running'),('datoms','Idle','idle'),('datoms','Under Maintenance','maintenance'),('datoms','Off','off');
insert into telemetry.asset_status_current select id,(array['Running','Idle','Under Maintenance','Off'])[1+(random()*3)::int],now()-interval '2 hours',now(),null from core.asset;
insert into telemetry.asset_location_current select a.id,p.latitude+random()/100,p.longitude+random()/100,null,null,now() from core.asset a join core.project p on p.id=a.project_id;
-- parameter dictionary
insert into telemetry.parameter(source_system,key,display_name,unit) select 'datoms','p'||lpad(g::text,3,'0'),'Param '||g,'u' from generate_series(1,103) g;
