import { Injectable } from '@nestjs/common';
import type { IHealthChecks } from '../contracts/health.interface';

@Injectable()
export class HealthRegistryService {
  private readonly checks: IHealthChecks[] = [];

  register(check: IHealthChecks) {
    this.checks.push(check);
  }

  getChecks() {
    return this.checks;
  }
}
