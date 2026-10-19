import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { InfraModule } from './infra/infra.module';
import { RoutesModule } from './modules/routes.module';

@Module({
  imports: [CoreModule, RoutesModule, InfraModule],
})
class AppModule {}

export { AppModule };
