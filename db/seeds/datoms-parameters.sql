-- =====================================================================
-- DATOMS parameter dictionary and category -> Nexus asset type mapping (docs/adr/0011)
-- ---------------------------------------------------------------------
-- Source: docs/source/datoms-parameters.md (markdown copy of datoms-parameters.xlsx), the list DATOMS
-- sent on 12 Oct 2026 with the provisional test key. Every row is copied exactly as the list gives it:
-- display name, key and unit. A blank unit in the list is NULL here. Nothing is invented.
--
-- Runs in EVERY environment (local, dev, prod) with `pnpm db:seed`. It is source data delivered outside
-- the API, not Nexus reference data, so it lives in db/seeds/ and not in schema.sql or a migration
-- (docs/06 section 8, rule 5). Safe to run again: rows are upserted on (source_system, source_type_name, key).
--   * display_name: the list wins (it is the source).
--   * unit: the list wins when it gives one; a blank unit never wipes a unit an admin filled in.
--   * data_type is NOT set: the list gives no types (Q22). The column default applies until the live
--     poll sees a value.
--
-- source_type_name is the DATOMS asset category as the list names it. The sheet's DG tab is named
-- "DG Set (18)"; the "(18)" is very likely the number of DG sets connected (docs/07 section 3.2), not
-- part of the category, so the category is "DG Set". Open question Q35: S2-02 records the real category
-- strings from GET /assets. If they differ, correct the strings in THIS FILE ONLY; until then unmatched
-- rows mean raw keys are shown, never wrong names.
--
-- Expected rows: DG Set 103, Fuel Tank 4, AC Sub-Meter 34, Solar Inverter 23 (total 164).
-- =====================================================================
SET client_encoding = 'UTF8';

BEGIN;

-- ---------------------------------------------------------------------
-- 1. DATOMS category -> Nexus asset type (mapping given by Ahmed, 12 Oct 2026; docs/adr/0011).
--    Appends to core.asset_type.source_names; never removes names an admin added.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM core.asset_type
      WHERE code IN ('diesel_generator', 'fuel_tank', 'mains', 'solar')) <> 4 THEN
    RAISE EXCEPTION 'core.asset_type is missing diesel_generator, fuel_tank, mains or solar (see db/schema.sql)';
  END IF;
END $$;

UPDATE core.asset_type t
SET source_names = t.source_names || m.source_name
FROM (VALUES
  ('diesel_generator', 'DG Set'),
  ('fuel_tank',        'Fuel Tank'),
  ('mains',            'AC Sub-Meter'),
  ('solar',            'Solar Inverter')
) AS m(code, source_name)
WHERE t.code = m.code
  AND NOT (m.source_name = ANY (t.source_names));

-- ---------------------------------------------------------------------
-- 2. DG Set: 103 parameters
-- ---------------------------------------------------------------------
INSERT INTO telemetry.parameter (source_system, source_type_name, display_name, key, unit) VALUES
  ('datoms', 'DG Set', 'Air Filter Differential Pressure', 'air_flt_dp', 'Bar'),
  ('datoms', 'DG Set', 'Ambient Air Temperature', 'amb_temp', '°C'),
  ('datoms', 'DG Set', 'Battery Voltage', 'vbat', 'V'),
  ('datoms', 'DG Set', 'BTS Battery Voltage 1', 'bts_vbat1', 'V'),
  ('datoms', 'DG Set', 'BTS Battery Voltage 2', 'bts_vbat2', 'V'),
  ('datoms', 'DG Set', 'Common electric trip', 'com_elec_trip_st', NULL),
  ('datoms', 'DG Set', 'Common notification', 'com_notificatn_st', NULL),
  ('datoms', 'DG Set', 'Common shut down', 'com_shtdn_st', NULL),
  ('datoms', 'DG Set', 'Common warning', 'com_warn_st', NULL),
  ('datoms', 'DG Set', 'Coolant Level', 'cool_lvl', '%'),
  ('datoms', 'DG Set', 'Coolant Temperature', 'temp', '°C'),
  ('datoms', 'DG Set', 'DEF Concentration', 'def_con', '%'),
  ('datoms', 'DG Set', 'DEF Tank Level', 'def_aft_t1', '%'),
  ('datoms', 'DG Set', 'DG Lock Status', 'dg_lock_status', NULL),
  ('datoms', 'DG Set', 'Energy Generation', 'calculated_energy', 'kWh'),
  ('datoms', 'DG Set', 'Engine Oil Level', 'eng_oil_lvl', '%'),
  ('datoms', 'DG Set', 'Engine Speed', 'rpm', 'RPM'),
  ('datoms', 'DG Set', 'Fuel Consumed', 'fuel_consume', 'L'),
  ('datoms', 'DG Set', 'Fuel Consumption', 'fuel_consumption', 'L'),
  ('datoms', 'DG Set', 'Fuel Consumption Percentage', 'fuel_consumption_perc', '%'),
  ('datoms', 'DG Set', 'Fuel Drain End Time', 'fuel_drain_end_time', NULL),
  ('datoms', 'DG Set', 'Fuel Drain End Value', 'fuel_drain_end_value', '%'),
  ('datoms', 'DG Set', 'Fuel Drain End Value Litres', 'fuel_drain_end_value_lt', 'L'),
  ('datoms', 'DG Set', 'Fuel Drain Start Time', 'fuel_drain_start_time', NULL),
  ('datoms', 'DG Set', 'Fuel Drain Start Value', 'fuel_drain_start_value', '%'),
  ('datoms', 'DG Set', 'Fuel Drain Start Value Litres', 'fuel_drain_start_value_lt', 'L'),
  ('datoms', 'DG Set', 'Fuel Drained', 'fuel_theft', 'L'),
  ('datoms', 'DG Set', 'Fuel Drained Percentage', 'fuel_theft_perc', '%'),
  ('datoms', 'DG Set', 'Fuel Efficiency', 'calculated_energy_p_fuel_consumption', 'kWh/L'),
  ('datoms', 'DG Set', 'Fuel Filled', 'fuel_filled', 'L'),
  ('datoms', 'DG Set', 'Fuel Filled Percentage', 'fuel_filled_perc', '%'),
  ('datoms', 'DG Set', 'Fuel Filling End Time', 'fuel_filling_end_time', NULL),
  ('datoms', 'DG Set', 'Fuel Filling End Value', 'fuel_filling_end_value', '%'),
  ('datoms', 'DG Set', 'Fuel Filling End Value Litres', 'fuel_filling_end_value_lt', 'L'),
  ('datoms', 'DG Set', 'Fuel Filling Start Time', 'fuel_filling_start_time', NULL),
  ('datoms', 'DG Set', 'Fuel Filling Start Value', 'fuel_filling_start_value', '%'),
  ('datoms', 'DG Set', 'Fuel Filling Start Value Litres', 'fuel_filling_start_value_lt', 'L'),
  ('datoms', 'DG Set', 'Fuel Filter Differential Pressure', 'fuel_flt_dp', 'Bar'),
  ('datoms', 'DG Set', 'Fuel Level', 'fuel', '%'),
  ('datoms', 'DG Set', 'Fuel Pressure', 'fuel_press', 'psi'),
  ('datoms', 'DG Set', 'Fuel Rate', 'fuel_rate', 'L/h'),
  ('datoms', 'DG Set', 'Gen available', 'gt_availability', NULL),
  ('datoms', 'DG Set', 'Generator Active Energy', 'enrg', 'kWh'),
  ('datoms', 'DG Set', 'Generator Apparent Energy', 'ga_energy', 'kVAh'),
  ('datoms', 'DG Set', 'Generator Avg Frequency', 'hz', 'Hz'),
  ('datoms', 'DG Set', 'Generator Avg L-N Voltage', 'volt', 'V'),
  ('datoms', 'DG Set', 'Generator Avg Power Factor', 'pf', NULL),
  ('datoms', 'DG Set', 'Generator L1 Active Power', 'gpow_r', 'kW'),
  ('datoms', 'DG Set', 'Generator L1 Apparent Power', 'gapow_r', 'kVA'),
  ('datoms', 'DG Set', 'Generator L1 Reactive Power', 'grpow_r', 'kVAR'),
  ('datoms', 'DG Set', 'Generator L2 Active Power', 'gpow_y', 'kW'),
  ('datoms', 'DG Set', 'Generator L2 Apparent Power', 'gapow_y', 'kVA'),
  ('datoms', 'DG Set', 'Generator L2 Reactive Power', 'grpow_y', 'kVAR'),
  ('datoms', 'DG Set', 'Generator L3 Active Power', 'gpow_b', 'kW'),
  ('datoms', 'DG Set', 'Generator L3 Apparent Power', 'gapow_b', 'kVA'),
  ('datoms', 'DG Set', 'Generator L3 Reactive Power', 'grpow_b', 'kVAR'),
  ('datoms', 'DG Set', 'Generator Reactive Energy', 'gr_energy', 'kVARh'),
  ('datoms', 'DG Set', 'Generator Total Active Power', 'watt', 'kW'),
  ('datoms', 'DG Set', 'Generator Total Apparent Power', 'apow', 'kVA'),
  ('datoms', 'DG Set', 'Generator Total Reactive Power', 'rpow', 'kVAR'),
  ('datoms', 'DG Set', 'Genset in fault', 'gt_under_fault', NULL),
  ('datoms', 'DG Set', 'Idle Run Hour', 'calculated_idle_hour', 'Sec'),
  ('datoms', 'DG Set', 'Latitude', 'lat', NULL),
  ('datoms', 'DG Set', 'Lifetime Fuel Consumption Rate', 'fuel_consumption_rate', 'L/h'),
  ('datoms', 'DG Set', 'Load Avg Current', 'curr', 'A'),
  ('datoms', 'DG Set', 'Load L1 Current', 'cur_ir', 'A'),
  ('datoms', 'DG Set', 'Load L2 Current', 'cur_iy', 'A'),
  ('datoms', 'DG Set', 'Load L3 Current', 'cur_ib', 'A'),
  ('datoms', 'DG Set', 'Load Percentage', 'load_percentage', '%'),
  ('datoms', 'DG Set', 'Longitude', 'long', NULL),
  ('datoms', 'DG Set', 'Lube Oil Pressure', 'press', 'Bar'),
  ('datoms', 'DG Set', 'Machine Status', 'mc_st', NULL),
  ('datoms', 'DG Set', 'Mains Active Energy', 'mt_energy', 'kWh'),
  ('datoms', 'DG Set', 'Mains Apparent Energy', 'ma_energy', 'kVAh'),
  ('datoms', 'DG Set', 'Mains Avg L-N Voltage', 'mvol', 'V'),
  ('datoms', 'DG Set', 'Mains Avg Power Factor', 'mt_pf', NULL),
  ('datoms', 'DG Set', 'Mains Current Phase1 (R)', 'mcur_ir', 'A'),
  ('datoms', 'DG Set', 'Mains Current Phase2 (Y)', 'mcur_iy', 'A'),
  ('datoms', 'DG Set', 'Mains Current Phase3 (B)', 'mcur_ib', 'A'),
  ('datoms', 'DG Set', 'Mains Current Total', 'mcurr', 'A'),
  ('datoms', 'DG Set', 'Mains L1 Active Power', 'mpow_r', 'kW'),
  ('datoms', 'DG Set', 'Mains L1 Apparent Power', 'mapow_r', 'kVA'),
  ('datoms', 'DG Set', 'Mains L1 Reactive Power', 'mrpow_r', 'kVAR'),
  ('datoms', 'DG Set', 'Mains L2 Active Power', 'mpow_y', 'kW'),
  ('datoms', 'DG Set', 'Mains L2 Apparent Power', 'mapow_y', 'kVA'),
  ('datoms', 'DG Set', 'Mains L2 Reactive Power', 'mrpow_y', 'kVAR'),
  ('datoms', 'DG Set', 'Mains L3 Active Power', 'mpow_b', 'kW'),
  ('datoms', 'DG Set', 'Mains L3 Apparent Power', 'mapow_b', 'kVA'),
  ('datoms', 'DG Set', 'Mains L3 Reactive Power', 'mrpow_b', 'kVAR'),
  ('datoms', 'DG Set', 'Mains Reactive Energy', 'mr_energy', 'kVARh'),
  ('datoms', 'DG Set', 'Mains Runhour', 'mrun_hr', 'Hr'),
  ('datoms', 'DG Set', 'Mains Total Active Power', 'mt_power', 'kW'),
  ('datoms', 'DG Set', 'Mains Total Apparent Power', 'ma_power', 'kVA'),
  ('datoms', 'DG Set', 'Mains Total Reactive Power', 'mr_power', 'kVAR'),
  ('datoms', 'DG Set', 'Maintenance', 'under_maintenance', NULL),
  ('datoms', 'DG Set', 'Movement Status', 'is_moving', NULL),
  ('datoms', 'DG Set', 'No of trips', 'no_of_trips', NULL),
  ('datoms', 'DG Set', 'Number of Emergency Stops', 'no_of_estops', NULL),
  ('datoms', 'DG Set', 'Offline Trip Fuel Consumption', 'offline_trip_consumption', 'L'),
  ('datoms', 'DG Set', 'Oil Filter Differential Pressure', 'oil_flt_dp', 'Bar'),
  ('datoms', 'DG Set', 'Room Temperature', 'rm_temp', '°C'),
  ('datoms', 'DG Set', 'Run Hour', 'rnhr', 'Hr'),
  ('datoms', 'DG Set', 'Service Hour Due', 'ser_due_hr', 'Hr')
ON CONFLICT ON CONSTRAINT parameter_source_type_key_uq DO UPDATE
  SET display_name = EXCLUDED.display_name,
      unit         = COALESCE(EXCLUDED.unit, telemetry.parameter.unit);

-- ---------------------------------------------------------------------
-- 3. Fuel Tank: 4 parameters
-- ---------------------------------------------------------------------
INSERT INTO telemetry.parameter (source_system, source_type_name, display_name, key, unit) VALUES
  ('datoms', 'Fuel Tank', 'Fuel Level', 'fuel', '%'),
  ('datoms', 'Fuel Tank', 'Fuel (Litre)', 'fuel_litre', 'L'),
  ('datoms', 'Fuel Tank', 'Fuel Consumption (Dispensed)', 'fuel_consumption', 'L'),
  ('datoms', 'Fuel Tank', 'Fuel Filled', 'fuel_filled', 'L')
ON CONFLICT ON CONSTRAINT parameter_source_type_key_uq DO UPDATE
  SET display_name = EXCLUDED.display_name,
      unit         = COALESCE(EXCLUDED.unit, telemetry.parameter.unit);

-- ---------------------------------------------------------------------
-- 4. AC Sub-Meter: 34 parameters
-- ---------------------------------------------------------------------
INSERT INTO telemetry.parameter (source_system, source_type_name, display_name, key, unit) VALUES
  ('datoms', 'AC Sub-Meter', 'Mains Runhour', 'mrun_hr', 'Hr'),
  ('datoms', 'AC Sub-Meter', 'Active Energy', 'mt_energy', 'kWh'),
  ('datoms', 'AC Sub-Meter', 'Total Active Power', 'mt_power', 'kW'),
  ('datoms', 'AC Sub-Meter', 'Avg L-N Voltage', 'mvol', 'V'),
  ('datoms', 'AC Sub-Meter', 'Average Phase Current', 'mcurr', 'A'),
  ('datoms', 'AC Sub-Meter', 'Total Phase Current', 'tot_curr', 'A'),
  ('datoms', 'AC Sub-Meter', 'L1-N Voltage', 'mvol_r', 'V'),
  ('datoms', 'AC Sub-Meter', 'L2-N Voltage', 'mvol_y', 'V'),
  ('datoms', 'AC Sub-Meter', 'L3-N Voltage', 'mvol_b', 'V'),
  ('datoms', 'AC Sub-Meter', 'L1-L2 Voltage', 'mvol_ry', 'V'),
  ('datoms', 'AC Sub-Meter', 'L2-L3 Voltage', 'mvol_yb', 'V'),
  ('datoms', 'AC Sub-Meter', 'L3-L1 Voltage', 'mvol_br', 'V'),
  ('datoms', 'AC Sub-Meter', 'Avg L-L Voltage', 'mvolt_p', 'V'),
  ('datoms', 'AC Sub-Meter', 'Phase Current L1', 'mcur_ir', 'A'),
  ('datoms', 'AC Sub-Meter', 'Phase Current L2', 'mcur_iy', 'A'),
  ('datoms', 'AC Sub-Meter', 'Phase Current L3', 'mcur_ib', 'A'),
  ('datoms', 'AC Sub-Meter', 'L1 Active Power', 'mpow_r', 'kW'),
  ('datoms', 'AC Sub-Meter', 'L2 Active Power', 'mpow_y', 'kW'),
  ('datoms', 'AC Sub-Meter', 'L3 Active Power', 'mpow_b', 'kW'),
  ('datoms', 'AC Sub-Meter', 'Total Reactive Power', 'mr_power', 'kVAR'),
  ('datoms', 'AC Sub-Meter', 'L1 Reactive Power', 'mrpow_r', 'kVAR'),
  ('datoms', 'AC Sub-Meter', 'L2 Reactive Power', 'mrpow_y', 'kVAR'),
  ('datoms', 'AC Sub-Meter', 'L3 Reactive Power', 'mrpow_b', 'kVAR'),
  ('datoms', 'AC Sub-Meter', 'Total Apparent Power', 'ma_power', 'kVA'),
  ('datoms', 'AC Sub-Meter', 'L1 Apparent Power', 'mapow_r', 'kVA'),
  ('datoms', 'AC Sub-Meter', 'L2 Apparent Power', 'mapow_y', 'kVA'),
  ('datoms', 'AC Sub-Meter', 'L3 Apparent Power', 'mapow_b', 'kVA'),
  ('datoms', 'AC Sub-Meter', 'Avg Power Factor', 'mt_pf', NULL),
  ('datoms', 'AC Sub-Meter', 'L1 Power Factor', 'mpf_r', NULL),
  ('datoms', 'AC Sub-Meter', 'L2 Power Factor', 'mpf_y', NULL),
  ('datoms', 'AC Sub-Meter', 'L3 Power Factor', 'mpf_b', NULL),
  ('datoms', 'AC Sub-Meter', 'Avg Frequency', 'mfreq', 'Hz'),
  ('datoms', 'AC Sub-Meter', 'Apparent Energy', 'ma_energy', 'kVAh'),
  ('datoms', 'AC Sub-Meter', 'Reactive Energy', 'mr_energy', 'kVARh')
ON CONFLICT ON CONSTRAINT parameter_source_type_key_uq DO UPDATE
  SET display_name = EXCLUDED.display_name,
      unit         = COALESCE(EXCLUDED.unit, telemetry.parameter.unit);

-- ---------------------------------------------------------------------
-- 5. Solar Inverter: 23 parameters
--    (The double space in "AC  L1/L2/L3 Active Power" is in the DATOMS list; kept as given.)
-- ---------------------------------------------------------------------
INSERT INTO telemetry.parameter (source_system, source_type_name, display_name, key, unit) VALUES
  ('datoms', 'Solar Inverter', 'AC  L1 Active Power', 'mpow_r', 'kW'),
  ('datoms', 'Solar Inverter', 'AC  L2 Active Power', 'mpow_y', 'kW'),
  ('datoms', 'Solar Inverter', 'AC  L3 Active Power', 'mpow_b', 'kW'),
  ('datoms', 'Solar Inverter', 'AC Apparent Energy', 'ma_energy', 'kVAh'),
  ('datoms', 'Solar Inverter', 'AC Average Phase Current', 'mcurr', 'A'),
  ('datoms', 'Solar Inverter', 'AC Average Power Factor', 'mt_pf', NULL),
  ('datoms', 'Solar Inverter', 'AC L1-L2 Voltage', 'mvol_ry', 'V'),
  ('datoms', 'Solar Inverter', 'AC L1-N Voltage', 'mvol_r', 'V'),
  ('datoms', 'Solar Inverter', 'AC L2-L3 Voltage', 'mvol_yb', 'V'),
  ('datoms', 'Solar Inverter', 'AC L2-N Voltage', 'mvol_y', 'V'),
  ('datoms', 'Solar Inverter', 'AC L3-L1 Voltage', 'mvol_br', 'V'),
  ('datoms', 'Solar Inverter', 'AC L3-N Voltage', 'mvol_b', 'V'),
  ('datoms', 'Solar Inverter', 'AC Phase Current L1', 'mcur_ir', 'A'),
  ('datoms', 'Solar Inverter', 'AC Phase Current L2', 'mcur_iy', 'A'),
  ('datoms', 'Solar Inverter', 'AC Phase Current L3', 'mcur_ib', 'A'),
  ('datoms', 'Solar Inverter', 'AC Reactive Energy', 'mr_energy', 'kVArh'),
  ('datoms', 'Solar Inverter', 'AC Total Apparent Power', 'ma_power', 'kVA'),
  ('datoms', 'Solar Inverter', 'AC Total Reactive Power', 'mr_power', 'kVAr'),
  ('datoms', 'Solar Inverter', 'Inverter Frequency', 'freq', 'Hz'),
  ('datoms', 'Solar Inverter', 'Phase Voltage', 'mvol', 'V'),
  ('datoms', 'Solar Inverter', 'Solar Energy', 'calculated_sol_enrg', 'kWh'),
  ('datoms', 'Solar Inverter', 'Solar Generation', 'sol_enrg', 'kWh'),
  ('datoms', 'Solar Inverter', 'Inverter Total Power', 'inv_power', 'kW')
ON CONFLICT ON CONSTRAINT parameter_source_type_key_uq DO UPDATE
  SET display_name = EXCLUDED.display_name,
      unit         = COALESCE(EXCLUDED.unit, telemetry.parameter.unit);

-- ---------------------------------------------------------------------
-- 6. Check: every category has at least the rows from the list (the live poll may add more keys later).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT e.source_type_name, e.expected,
           (SELECT count(*) FROM telemetry.parameter p
            WHERE p.source_system = 'datoms' AND p.source_type_name = e.source_type_name) AS actual
    FROM (VALUES ('DG Set', 103), ('Fuel Tank', 4), ('AC Sub-Meter', 34), ('Solar Inverter', 23))
         AS e(source_type_name, expected)
  LOOP
    IF r.actual < r.expected THEN
      RAISE EXCEPTION 'datoms-parameters seed: % has % rows, expected at least %',
        r.source_type_name, r.actual, r.expected;
    END IF;
  END LOOP;
END $$;

COMMIT;
