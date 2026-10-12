# DATOMS parameter list (markdown copy of datoms-parameters.xlsx)
> Provided by DATOMS on 12 Oct 2026 with the test key. Read-only copy for agents; the .xlsx is the source.
> Keys are the JSON keys in the API `parameters` object. Units are DATOMS defaults. Nexus shows these exactly as reported.

## DG Set (18) (103 parameters)

| Parameter name | Key | Default unit |
|---|---|---|
| Air Filter Differential Pressure | `air_flt_dp` | Bar |
| Ambient Air Temperature | `amb_temp` | °C |
| Battery Voltage | `vbat` | V |
| BTS Battery Voltage 1 | `bts_vbat1` | V |
| BTS Battery Voltage 2 | `bts_vbat2` | V |
| Common electric trip | `com_elec_trip_st` |  |
| Common notification | `com_notificatn_st` |  |
| Common shut down | `com_shtdn_st` |  |
| Common warning | `com_warn_st` |  |
| Coolant Level | `cool_lvl` | % |
| Coolant Temperature | `temp` | °C |
| DEF Concentration | `def_con` | % |
| DEF Tank Level | `def_aft_t1` | % |
| DG Lock Status | `dg_lock_status` |  |
| Energy Generation | `calculated_energy` | kWh |
| Engine Oil Level | `eng_oil_lvl` | % |
| Engine Speed | `rpm` | RPM |
| Fuel Consumed | `fuel_consume` | L |
| Fuel Consumption | `fuel_consumption` | L |
| Fuel Consumption Percentage | `fuel_consumption_perc` | % |
| Fuel Drain End Time | `fuel_drain_end_time` |  |
| Fuel Drain End Value | `fuel_drain_end_value` | % |
| Fuel Drain End Value Litres | `fuel_drain_end_value_lt` | L |
| Fuel Drain Start Time | `fuel_drain_start_time` |  |
| Fuel Drain Start Value | `fuel_drain_start_value` | % |
| Fuel Drain Start Value Litres | `fuel_drain_start_value_lt` | L |
| Fuel Drained | `fuel_theft` | L |
| Fuel Drained Percentage | `fuel_theft_perc` | % |
| Fuel Efficiency | `calculated_energy_p_fuel_consumption` | kWh/L |
| Fuel Filled | `fuel_filled` | L |
| Fuel Filled Percentage | `fuel_filled_perc` | % |
| Fuel Filling End Time | `fuel_filling_end_time` |  |
| Fuel Filling End Value | `fuel_filling_end_value` | % |
| Fuel Filling End Value Litres | `fuel_filling_end_value_lt` | L |
| Fuel Filling Start Time | `fuel_filling_start_time` |  |
| Fuel Filling Start Value | `fuel_filling_start_value` | % |
| Fuel Filling Start Value Litres | `fuel_filling_start_value_lt` | L |
| Fuel Filter Differential Pressure | `fuel_flt_dp` | Bar |
| Fuel Level | `fuel` | % |
| Fuel Pressure | `fuel_press` | psi |
| Fuel Rate | `fuel_rate` | L/h |
| Gen available | `gt_availability` |  |
| Generator Active Energy | `enrg` | kWh |
| Generator Apparent Energy | `ga_energy` | kVAh |
| Generator Avg Frequency | `hz` | Hz |
| Generator Avg L-N Voltage | `volt` | V |
| Generator Avg Power Factor | `pf` |  |
| Generator L1 Active Power | `gpow_r` | kW |
| Generator L1 Apparent Power | `gapow_r` | kVA |
| Generator L1 Reactive Power | `grpow_r` | kVAR |
| Generator L2 Active Power | `gpow_y` | kW |
| Generator L2 Apparent Power | `gapow_y` | kVA |
| Generator L2 Reactive Power | `grpow_y` | kVAR |
| Generator L3 Active Power | `gpow_b` | kW |
| Generator L3 Apparent Power | `gapow_b` | kVA |
| Generator L3 Reactive Power | `grpow_b` | kVAR |
| Generator Reactive Energy | `gr_energy` | kVARh |
| Generator Total Active Power | `watt` | kW |
| Generator Total Apparent Power | `apow` | kVA |
| Generator Total Reactive Power | `rpow` | kVAR |
| Genset in fault | `gt_under_fault` |  |
| Idle Run Hour | `calculated_idle_hour` | Sec |
| Latitude | `lat` |  |
| Lifetime Fuel Consumption Rate | `fuel_consumption_rate` | L/h |
| Load Avg Current | `curr` | A |
| Load L1 Current | `cur_ir` | A |
| Load L2 Current | `cur_iy` | A |
| Load L3 Current | `cur_ib` | A |
| Load Percentage | `load_percentage` | % |
| Longitude | `long` |  |
| Lube Oil Pressure | `press` | Bar |
| Machine Status | `mc_st` |  |
| Mains Active Energy | `mt_energy` | kWh |
| Mains Apparent Energy | `ma_energy` | kVAh |
| Mains Avg L-N Voltage | `mvol` | V |
| Mains Avg Power Factor | `mt_pf` |  |
| Mains Current Phase1 (R) | `mcur_ir` | A |
| Mains Current Phase2 (Y) | `mcur_iy` | A |
| Mains Current Phase3 (B) | `mcur_ib` | A |
| Mains Current Total | `mcurr` | A |
| Mains L1 Active Power | `mpow_r` | kW |
| Mains L1 Apparent Power | `mapow_r` | kVA |
| Mains L1 Reactive Power | `mrpow_r` | kVAR |
| Mains L2 Active Power | `mpow_y` | kW |
| Mains L2 Apparent Power | `mapow_y` | kVA |
| Mains L2 Reactive Power | `mrpow_y` | kVAR |
| Mains L3 Active Power | `mpow_b` | kW |
| Mains L3 Apparent Power | `mapow_b` | kVA |
| Mains L3 Reactive Power | `mrpow_b` | kVAR |
| Mains Reactive Energy | `mr_energy` | kVARh |
| Mains Runhour | `mrun_hr` | Hr |
| Mains Total Active Power | `mt_power` | kW |
| Mains Total Apparent Power | `ma_power` | kVA |
| Mains Total Reactive Power | `mr_power` | kVAR |
| Maintenance | `under_maintenance` |  |
| Movement Status | `is_moving` |  |
| No of trips | `no_of_trips` |  |
| Number of Emergency Stops | `no_of_estops` |  |
| Offline Trip Fuel Consumption | `offline_trip_consumption` | L |
| Oil Filter Differential Pressure | `oil_flt_dp` | Bar |
| Room Temperature | `rm_temp` | °C |
| Run Hour | `rnhr` | Hr |
| Service Hour Due | `ser_due_hr` | Hr |

## Fuel Tank (4 parameters)

| Parameter name | Key | Default unit |
|---|---|---|
| Fuel Level | `fuel` | % |
| Fuel (Litre) | `fuel_litre` | L |
| Fuel Consumption (Dispensed) | `fuel_consumption` | L |
| Fuel Filled | `fuel_filled` | L |

## AC Sub-Meter (34 parameters)

| Parameter name | Key | Default unit |
|---|---|---|
| Mains Runhour | `mrun_hr` | Hr |
| Active Energy | `mt_energy` | kWh |
| Total Active Power | `mt_power` | kW |
| Avg L-N Voltage | `mvol` | V |
| Average Phase Current | `mcurr` | A |
| Total Phase Current | `tot_curr` | A |
| L1-N Voltage | `mvol_r` | V |
| L2-N Voltage | `mvol_y` | V |
| L3-N Voltage | `mvol_b` | V |
| L1-L2 Voltage | `mvol_ry` | V |
| L2-L3 Voltage | `mvol_yb` | V |
| L3-L1 Voltage | `mvol_br` | V |
| Avg L-L Voltage | `mvolt_p` | V |
| Phase Current L1 | `mcur_ir` | A |
| Phase Current L2 | `mcur_iy` | A |
| Phase Current L3 | `mcur_ib` | A |
| L1 Active Power | `mpow_r` | kW |
| L2 Active Power | `mpow_y` | kW |
| L3 Active Power | `mpow_b` | kW |
| Total Reactive Power | `mr_power` | kVAR |
| L1 Reactive Power | `mrpow_r` | kVAR |
| L2 Reactive Power | `mrpow_y` | kVAR |
| L3 Reactive Power | `mrpow_b` | kVAR |
| Total Apparent Power | `ma_power` | kVA |
| L1 Apparent Power | `mapow_r` | kVA |
| L2 Apparent Power | `mapow_y` | kVA |
| L3 Apparent Power | `mapow_b` | kVA |
| Avg Power Factor | `mt_pf` |  |
| L1 Power Factor | `mpf_r` |  |
| L2 Power Factor | `mpf_y` |  |
| L3 Power Factor | `mpf_b` |  |
| Avg Frequency | `mfreq` | Hz |
| Apparent Energy | `ma_energy` | kVAh |
| Reactive Energy | `mr_energy` | kVARh |

## Solar Inverter (23 parameters)

| Parameter name | Key | Default unit |
|---|---|---|
| AC  L1 Active Power | `mpow_r` | kW |
| AC  L2 Active Power | `mpow_y` | kW |
| AC  L3 Active Power | `mpow_b` | kW |
| AC Apparent Energy | `ma_energy` | kVAh |
| AC Average Phase Current | `mcurr` | A |
| AC Average Power Factor | `mt_pf` |  |
| AC L1-L2 Voltage | `mvol_ry` | V |
| AC L1-N Voltage | `mvol_r` | V |
| AC L2-L3 Voltage | `mvol_yb` | V |
| AC L2-N Voltage | `mvol_y` | V |
| AC L3-L1 Voltage | `mvol_br` | V |
| AC L3-N Voltage | `mvol_b` | V |
| AC Phase Current L1 | `mcur_ir` | A |
| AC Phase Current L2 | `mcur_iy` | A |
| AC Phase Current L3 | `mcur_ib` | A |
| AC Reactive Energy | `mr_energy` | kVArh |
| AC Total Apparent Power | `ma_power` | kVA |
| AC Total Reactive Power | `mr_power` | kVAr |
| Inverter Frequency | `freq` | Hz |
| Phase Voltage | `mvol` | V |
| Solar Energy | `calculated_sol_enrg` | kWh |
| Solar Generation | `sol_enrg` | kWh |
| Inverter Total Power | `inv_power` | kW |

## Keys used in more than one category (31)

Same key, possibly different display name per category. The parameter dictionary must store display names per asset category.

| Key | Category: name (unit) |
|---|---|
| `fuel` | DG Set (18): Fuel Level (%); Fuel Tank: Fuel Level (%) |
| `fuel_consumption` | DG Set (18): Fuel Consumption (L); Fuel Tank: Fuel Consumption (Dispensed) (L) |
| `fuel_filled` | DG Set (18): Fuel Filled (L); Fuel Tank: Fuel Filled (L) |
| `ma_energy` | DG Set (18): Mains Apparent Energy (kVAh); AC Sub-Meter: Apparent Energy (kVAh); Solar Inverter: AC Apparent Energy (kVAh) |
| `ma_power` | DG Set (18): Mains Total Apparent Power (kVA); AC Sub-Meter: Total Apparent Power (kVA); Solar Inverter: AC Total Apparent Power (kVA) |
| `mapow_b` | DG Set (18): Mains L3 Apparent Power (kVA); AC Sub-Meter: L3 Apparent Power (kVA) |
| `mapow_r` | DG Set (18): Mains L1 Apparent Power (kVA); AC Sub-Meter: L1 Apparent Power (kVA) |
| `mapow_y` | DG Set (18): Mains L2 Apparent Power (kVA); AC Sub-Meter: L2 Apparent Power (kVA) |
| `mcur_ib` | DG Set (18): Mains Current Phase3 (B) (A); AC Sub-Meter: Phase Current L3 (A); Solar Inverter: AC Phase Current L3 (A) |
| `mcur_ir` | DG Set (18): Mains Current Phase1 (R) (A); AC Sub-Meter: Phase Current L1 (A); Solar Inverter: AC Phase Current L1 (A) |
| `mcur_iy` | DG Set (18): Mains Current Phase2 (Y) (A); AC Sub-Meter: Phase Current L2 (A); Solar Inverter: AC Phase Current L2 (A) |
| `mcurr` | DG Set (18): Mains Current Total (A); AC Sub-Meter: Average Phase Current (A); Solar Inverter: AC Average Phase Current (A) |
| `mpow_b` | DG Set (18): Mains L3 Active Power (kW); AC Sub-Meter: L3 Active Power (kW); Solar Inverter: AC  L3 Active Power (kW) |
| `mpow_r` | DG Set (18): Mains L1 Active Power (kW); AC Sub-Meter: L1 Active Power (kW); Solar Inverter: AC  L1 Active Power (kW) |
| `mpow_y` | DG Set (18): Mains L2 Active Power (kW); AC Sub-Meter: L2 Active Power (kW); Solar Inverter: AC  L2 Active Power (kW) |
| `mr_energy` | DG Set (18): Mains Reactive Energy (kVARh); AC Sub-Meter: Reactive Energy (kVARh); Solar Inverter: AC Reactive Energy (kVArh) |
| `mr_power` | DG Set (18): Mains Total Reactive Power (kVAR); AC Sub-Meter: Total Reactive Power (kVAR); Solar Inverter: AC Total Reactive Power (kVAr) |
| `mrpow_b` | DG Set (18): Mains L3 Reactive Power (kVAR); AC Sub-Meter: L3 Reactive Power (kVAR) |
| `mrpow_r` | DG Set (18): Mains L1 Reactive Power (kVAR); AC Sub-Meter: L1 Reactive Power (kVAR) |
| `mrpow_y` | DG Set (18): Mains L2 Reactive Power (kVAR); AC Sub-Meter: L2 Reactive Power (kVAR) |
| `mrun_hr` | DG Set (18): Mains Runhour (Hr); AC Sub-Meter: Mains Runhour (Hr) |
| `mt_energy` | DG Set (18): Mains Active Energy (kWh); AC Sub-Meter: Active Energy (kWh) |
| `mt_pf` | DG Set (18): Mains Avg Power Factor (—); AC Sub-Meter: Avg Power Factor (—); Solar Inverter: AC Average Power Factor (—) |
| `mt_power` | DG Set (18): Mains Total Active Power (kW); AC Sub-Meter: Total Active Power (kW) |
| `mvol` | DG Set (18): Mains Avg L-N Voltage (V); AC Sub-Meter: Avg L-N Voltage (V); Solar Inverter: Phase Voltage (V) |
| `mvol_b` | AC Sub-Meter: L3-N Voltage (V); Solar Inverter: AC L3-N Voltage (V) |
| `mvol_br` | AC Sub-Meter: L3-L1 Voltage (V); Solar Inverter: AC L3-L1 Voltage (V) |
| `mvol_r` | AC Sub-Meter: L1-N Voltage (V); Solar Inverter: AC L1-N Voltage (V) |
| `mvol_ry` | AC Sub-Meter: L1-L2 Voltage (V); Solar Inverter: AC L1-L2 Voltage (V) |
| `mvol_y` | AC Sub-Meter: L2-N Voltage (V); Solar Inverter: AC L2-N Voltage (V) |
| `mvol_yb` | AC Sub-Meter: L2-L3 Voltage (V); Solar Inverter: AC L2-L3 Voltage (V) |
