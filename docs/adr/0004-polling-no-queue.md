# 0004 · 60-second bulk polling by one worker; no message queue in phase 1

- **Status:** accepted
- **Date:** 2026-10-07

## Context
- DATOMS v4 offers bulk latest telemetry (500 assets per call) with credit caps designed for one full-fleet poll per minute.
- No streaming or webhooks are documented yet.
- Users want changes "immediately".

## Decision
- A single leader worker polls the bulk endpoint every 60 s (adaptive under limits), writes the changes and pushes them to browsers through Azure Web PubSub.
- There is no Kafka or Service Bus.
- Expected screen delay: up to about 60–90 s after the device reports.

## Consequences
- This is simple and cheap, and the number of users has no effect on DATOMS load.
- "Instant" (under 10 s) needs DATOMS streaming or webhooks. If they are offered, add an ingest path with Azure Service Bus (new ADR). The screens and the live push stay the same.
