import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { remoteRequestReason } from './local-request.js';

/** The part of the Fastify instance used here (fastify itself is not a direct dependency). */
interface OnRequestHost {
  addHook(
    name: 'onRequest',
    hook: (
      request: { headers: IncomingHttpHeaders; raw: { socket: { remoteAddress?: string } } },
      reply: {
        code(status: number): { type(value: string): { send(body: unknown): Promise<unknown> } };
      },
    ) => Promise<void>,
  ): void;
}

/**
 * While AUTH_MODE=dev, every route (also unknown paths and health) refuses a request that does not
 * look local: see remoteRequestReason. Defends against tunnels, local reverse proxies and DNS
 * rebinding, which all arrive from loopback.
 */
@Injectable()
export class LocalRequestHook implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance<OnRequestHost>();
    fastify.addHook('onRequest', async (request, reply) => {
      const reason = remoteRequestReason(
        request.headers,
        request.raw.socket.remoteAddress,
        this.config.http.corsOrigins,
      );
      if (reason === null) return;
      await reply.code(403).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'Local development mode answers only to requests from this machine.',
      });
    });
  }
}
