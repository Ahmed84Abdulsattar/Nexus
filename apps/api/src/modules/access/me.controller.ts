import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { meResponseSchema } from '@nexus/shared';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AnySignedIn } from '../../common/auth/decorators.js';
import { CurrentAuth, type CurrentAuthValue } from './current-auth.js';
import { ME_REPOSITORY, type MeRepository } from './me.repository.js';

class MeResponseDto extends createZodDto(meResponseSchema) {}

@ApiTags('access')
@Controller('me')
export class MeController {
  constructor(@Inject(ME_REPOSITORY) private readonly repository: MeRepository) {}

  /** docs/10, docs/08 section 5. Only the caller's own data, taken from the AccessContext. */
  @AnySignedIn()
  @Get()
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, description: 'The signed-in user.', type: MeResponseDto })
  async me(@CurrentAuth() auth: CurrentAuthValue): Promise<MeResponseDto> {
    const { access } = auth;
    const profile = await this.repository.profile(access.userId);
    return {
      id: access.userId,
      name: profile.name,
      email: profile.email,
      roles: [...access.roles].sort(),
      permissions: [...access.permissions].sort(),
      projectScope: {
        all: access.allProjects,
        projectIds: access.allProjects ? [] : [...access.projectIds].sort(),
      },
    };
  }
}
