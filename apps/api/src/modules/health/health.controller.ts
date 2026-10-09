import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth/decorators.js';

/** Liveness only. /health/* is the one @Public area (docs/10). /health/ready comes with the database. */
@Controller('health')
export class HealthController {
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
