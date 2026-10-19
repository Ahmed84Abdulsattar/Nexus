import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { configResponseSchema } from '@nexus/shared';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AnySignedIn } from '../../common/auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import {
  ARCGIS_BASEMAPS,
  INITIAL_VIEW,
  PROJECT_STATE_KEYS,
  toEnumEntries,
  UAE_EXTENT,
  UNMAPPED_DISPLAY_STATUS,
} from './client-config.js';
import { CLIENT_CONFIG_REPOSITORY, type ClientConfigRepository } from './config.repository.js';

class ConfigResponseDto extends createZodDto(configResponseSchema) {}

@ApiTags('config')
@Controller('config')
export class ClientConfigController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLIENT_CONFIG_REPOSITORY) private readonly repository: ClientConfigRepository,
  ) {}

  /**
   * docs/10. Carries the referrer-restricted ArcGIS key, the only credential allowed in a response,
   * so it is never cached. Every other field is built here from an explicit list: no env value is
   * passed through.
   */
  @AnySignedIn()
  @Get()
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, description: 'Client configuration.', type: ConfigResponseDto })
  async get(): Promise<ConfigResponseDto> {
    const [featureFlags, statusKeys] = await Promise.all([
      this.repository.featureFlags(),
      this.repository.displayStatusKeys(),
    ]);
    return {
      arcgis: {
        apiKey: this.config.arcgis.apiKey ?? '',
        basemaps: ARCGIS_BASEMAPS,
        extent: UAE_EXTENT,
        initialView: INITIAL_VIEW,
      },
      enums: {
        projectStates: toEnumEntries(PROJECT_STATE_KEYS),
        displayStatuses: toEnumEntries([...statusKeys, UNMAPPED_DISPLAY_STATUS]),
      },
      featureFlags,
    };
  }
}
