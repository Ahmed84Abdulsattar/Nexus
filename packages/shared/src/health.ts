import { z } from 'zod';

/** GET /health/live (docs/10). */
export const healthLiveSchema = z.object({ status: z.literal('ok') });
export type HealthLive = z.infer<typeof healthLiveSchema>;
