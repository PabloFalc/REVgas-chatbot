import { Module } from '@nestjs/common';
import { RevgasModule } from '../../integrations/revgas/revgas.module';
import { CustomerRepository } from './customer.repository';

@Module({
  imports: [RevgasModule],
  providers: [CustomerRepository],
  exports: [CustomerRepository],
})
export class CustomerModule {}
