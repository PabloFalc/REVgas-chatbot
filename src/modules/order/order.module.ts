import { Module } from '@nestjs/common';
import { RevgasModule } from 'src/integrations/revgas/revgas.module';
import { OrderRepository } from './order.repository';

@Module({
  imports: [RevgasModule],
  providers: [OrderRepository],
  exports: [OrderRepository],
})
export class OrderModule {}
