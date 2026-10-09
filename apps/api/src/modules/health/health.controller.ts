import { Controller, Get } from '@nestjs/common';

/**
 * Liveness only. This route is @Public per docs/10; the @Public decorator and the default-deny
 * guard arrive in S1-02, so there is nothing to mark yet. /health/ready comes with the database.
 */
@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
