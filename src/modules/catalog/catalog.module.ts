import { Module } from '@nestjs/common';
import { CacheModule } from 'src/infra/cache/cache.module';
import { RevgasModule } from 'src/integrations/revgas/revgas.module';
import { CatalogRepository } from './catalog.repository';

@Module({
  imports: [RevgasModule, CacheModule],
  providers: [CatalogRepository],
  exports: [CatalogRepository],
})
export class CatalogModule {}
