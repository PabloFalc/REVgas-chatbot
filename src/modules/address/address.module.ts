import { Module } from '@nestjs/common';
import { LlmModule } from '../../integrations/llm/llm.module';
import { ViacepModule } from '../../integrations/viacep/viacep.module';
import { AddressService } from './address.service';

@Module({
  imports: [ViacepModule, LlmModule],
  providers: [AddressService],
  exports: [AddressService],
})
export class AddressModule {}
