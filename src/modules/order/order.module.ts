import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/infra/database/database.module';
import { RevgasModule } from 'src/integrations/revgas/revgas.module';
import { OrderRepository } from './order.repository';
import { SaleAttemptsRepository } from './sale-attempts.repository';

@Module({
  imports: [RevgasModule, DatabaseModule],
  providers: [OrderRepository, SaleAttemptsRepository],
  exports: [OrderRepository, SaleAttemptsRepository],
})
export class OrderModule {}
