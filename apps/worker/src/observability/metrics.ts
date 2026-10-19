import { Injectable, Logger } from '@nestjs/common';

/**
 * A counter with attributes. The worker never imports an APM SDK in jobs: it calls this, and the
 * implementation decides. Today it writes a structured log line; S8-02 swaps in the OpenTelemetry
 * counter that App Insights alert rules read (same name, same attributes).
 */
export abstract class Metrics {
  abstract increment(name: string, attributes?: Record<string, string | number>): void;
}

@Injectable()
export class LoggingMetrics extends Metrics {
  private readonly logger = new Logger('Metrics');

  increment(name: string, attributes: Record<string, string | number> = {}): void {
    this.logger.log(JSON.stringify({ metric: name, value: 1, ...attributes }));
  }
}
