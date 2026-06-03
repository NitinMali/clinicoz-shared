import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

/**
 * Global configuration module. Registered as global so that
 * ConfigService is available throughout the application without
 * needing to import ConfigModule in every feature module.
 */
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
