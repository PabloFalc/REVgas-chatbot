import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { authGuard } from 'src/core/guards/auth.guard';
import { EmailModule } from 'src/core/services/email/email.module';
import { betterAuthInstance } from './auth';
import { EmailAuthController } from './email/email-auth.controller';
import { SessionController } from './session/session.controller';
import { UserController } from './user/user.controller';

@Module({
  imports: [EmailModule],
  controllers: [EmailAuthController, SessionController, UserController],
  providers: [betterAuthInstance, authGuard],
})
export class AuthModule {}

export const authModule = [
  AuthModule,
  RouterModule.register([
    {
      path: 'auth',
      module: AuthModule,
    },
  ]),
];
