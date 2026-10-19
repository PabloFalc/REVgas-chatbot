import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { AllowUnverified } from 'src/core/decorators/auth/auth-metadata.decorator';
import { Session } from 'src/core/decorators/auth/session.decorator';
import { GetHeaders } from 'src/core/decorators/get-headers.decorator';
import type { ISession } from 'src/core/shared/session.dto';
import { BETTER_AUTH_TOKEN, type BetterAuth } from '../auth';
import {
  getSessionDoc,
  listSessionsDoc,
  revokeOtherSessionsDoc,
  revokeSessionDoc,
  signOutDoc,
} from './docs/session.doc';
import { RevokeSessionDto } from './dtos/session.dto';

@Controller()
export class SessionController {
  constructor(@Inject(BETTER_AUTH_TOKEN) private readonly auth: BetterAuth) {}

  @ApiDoc(getSessionDoc)
  @AllowUnverified()
  @Get('get-session')
  getSession(@Session() session: ISession) {
    return session;
  }

  @ApiDoc(signOutDoc)
  @AllowUnverified()
  @Post('sign-out')
  signOut(@GetHeaders() headers: Headers) {
    return this.auth.api.signOut({ headers });
  }

  @ApiDoc(listSessionsDoc)
  @Get('sessions')
  listSessions(@GetHeaders() headers: Headers) {
    return this.auth.api.listSessions({ headers });
  }

  @ApiDoc(revokeSessionDoc)
  @Post('sessions/revoke')
  revokeSession(@Body() body: RevokeSessionDto, @GetHeaders() headers: Headers) {
    return this.auth.api.revokeSession({ body, headers });
  }

  @ApiDoc(revokeOtherSessionsDoc)
  @Post('sessions/revoke-others')
  revokeOtherSessions(@GetHeaders() headers: Headers) {
    return this.auth.api.revokeOtherSessions({ headers });
  }
}
