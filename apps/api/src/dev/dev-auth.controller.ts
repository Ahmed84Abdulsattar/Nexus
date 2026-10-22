import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DEV_USERS, devTokenRequestSchema, type DevTokenResponse } from '@nexus/shared';
import type { IncomingHttpHeaders } from 'node:http';
import { createZodDto } from 'nestjs-zod';
import { DEV_KEY_SOURCE } from '../common/auth/dev-key-source.js';
import { Public } from '../common/auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { remoteRequestReason } from './local-request.js';
import { DEV_TOKEN_TTL_SECONDS, type DevKeyService } from './dev-key.service.js';

class DevTokenRequestDto extends createZodDto(devTokenRequestSchema) {}

/**
 * POST /v1/dev/token (docs/08 "Local development sign-in"). Exists only when AUTH_MODE=dev and
 * APP_ENV=local. @Public because nobody has a token yet; it answers only to this machine. Not in
 * the OpenAPI document.
 */
@ApiExcludeController()
@Controller('dev')
export class DevAuthController {
  constructor(
    @Inject(DEV_KEY_SOURCE) private readonly keys: DevKeyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('token')
  @HttpCode(200)
  async token(
    @Body() body: DevTokenRequestDto,
    @Req() request: { headers: IncomingHttpHeaders; raw: { socket: { remoteAddress?: string } } },
  ): Promise<DevTokenResponse> {
    // Also checked by LocalRequestHook on every route; repeated here so this route is safe alone.
    // The socket peer, never request.ip (a proxy header could set that).
    if (
      remoteRequestReason(
        request.headers,
        request.raw.socket.remoteAddress,
        this.config.http.corsOrigins,
      ) !== null
    ) {
      throw new ForbiddenException('Local sign-in answers only to this machine.');
    }
    const user = DEV_USERS.find((u) => u.key === body.user);
    if (!user) {
      throw new BadRequestException(
        `Unknown demo user. Use one of: ${DEV_USERS.map((u) => u.key).join(', ')}.`,
      );
    }
    const { auth } = this.config;
    const accessToken = await this.keys.sign(
      {
        tid: auth.tenantId,
        oid: user.oid,
        azp: auth.webClientId,
        scp: auth.requiredScope,
        groups: [user.groupId],
        name: user.name,
        preferred_username: user.email,
        ver: '2.0',
      },
      auth.issuer,
      auth.audiences[0] as string,
    );
    return {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: DEV_TOKEN_TTL_SECONDS,
      user: { key: user.key, name: user.name },
    };
  }
}
