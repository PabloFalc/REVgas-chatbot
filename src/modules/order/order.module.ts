import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/infra/database/database.module';
import { RevgasModule } from 'src/integrations/revgas/revgas.module';
import { MetricsModule } from 'src/modules/metrics/metrics.module';
import { OrderRepository } from './order.repository';
import { SaleAttemptsRepository } from './sale-attempts.repository';
import { SaleAttemptsSweeper } from './sale-attempts.sweeper';

@Module({
  imports: [RevgasModule, DatabaseModule, MetricsModule],
  providers: [OrderRepository, SaleAttemptsRepository, SaleAttemptsSweeper],
  exports: [OrderRepository, SaleAttemptsRepository],
})
export class OrderModule {}
