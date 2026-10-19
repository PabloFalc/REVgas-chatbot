import { Controller, Get, Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { Public } from 'src/core/decorators/auth/auth-metadata.decorator';
import { HEALTH_THROTTLE } from 'src/core/guards/rate-limit.guard';
import { checkDocument } from './docs/health.doc';
import { publicHealth } from './health.public';
import { HealthService } from './health.service';

@Public()
@Controller('/health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly service: HealthService) {}

  @Throttle(HEALTH_THROTTLE)
  @ApiDoc(checkDocument)
  @Get('/')
  async check() {
    const result = await this.service.check();
    return publicHealth(result);
  }
}
