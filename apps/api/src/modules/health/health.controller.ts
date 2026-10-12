import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { healthLiveSchema } from '@nexus/shared';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators.js';

class HealthLiveDto extends createZodDto(healthLiveSchema) {}

/** Liveness only. /health/* is the one @Public area (docs/10). /health/ready comes with the database. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get('live')
  @ZodResponse({ status: 200, description: 'The process is up.', type: HealthLiveDto })
  live(): HealthLiveDto {
    return { status: 'ok' };
  }
}
