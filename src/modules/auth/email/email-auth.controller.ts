import { Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { AllowAnonymous, AllowUnverified } from 'src/core/decorators/auth/auth-metadata.decorator';
import { Session } from 'src/core/decorators/auth/session.decorator';
import { GetHeaders } from 'src/core/decorators/get-headers.decorator';
import { BadRequestError, ConflictError } from 'src/core/erros/http.errors';
import { STRICT_AUTH_THROTTLE } from 'src/core/guards/rate-limit.guard';
import type { ISession } from 'src/core/shared/session.dto';
import { BETTER_AUTH_TOKEN, type BetterAuth, isTrustedCallbackURL } from '../auth';
import {
  changePasswordDoc,
  forgetPasswordDoc,
  resetPasswordDoc,
  signInWithEmailDoc,
  signUpWithEmailDoc,
  verifyEmailCallbackDoc,
  verifyEmailDoc,
} from './docs/email-auth.doc';
import { SignInWithEmail, SignUpWithEmail } from './dtos/auth.dto';
import { ChangePasswordDto } from './dtos/change-password.dto';
import { ForgetPasswordDto, ResetPasswordDto } from './dtos/password-reset.dto';
import { VerifyEmailDto } from './dtos/verify-email.dto';

@Controller({ path: 'email' })
export class EmailAuthController {
  constructor(@Inject(BETTER_AUTH_TOKEN) private readonly auth: BetterAuth) {}

  @ApiDoc(signInWithEmailDoc)
  @Throttle(STRICT_AUTH_THROTTLE)
  @AllowAnonymous()
  @Post('sign-in')
  signIn(
    @Session() session: ISession | null,
    @Body() body: SignInWithEmail,
    @GetHeaders() headers: Headers,
  ) {
    if (session) throw new ConflictError({ message: 'Usuário já autenticado' });

    return this.auth.api.signInEmail({ body, headers });
  }

  @ApiDoc(signUpWithEmailDoc)
  @Throttle(STRICT_AUTH_THROTTLE)
  @AllowAnonymous()
  @Post('sign-up')
  signUp(
    @Session() session: ISession | null,
    @Body() body: SignUpWithEmail,
    @GetHeaders() headers: Headers,
  ) {
    if (session) throw new ConflictError({ message: 'Usuário já autenticado' });

    return this.auth.api.signUpEmail({ body, headers });
  }

  @ApiDoc(forgetPasswordDoc)
  @Throttle(STRICT_AUTH_THROTTLE)
  @AllowAnonymous()
  @Post('forget-password')
  forgetPassword(@Body() body: ForgetPasswordDto, @GetHeaders() headers: Headers) {
    return this.auth.api.requestPasswordReset({ body, headers });
  }

  @ApiDoc(resetPasswordDoc)
  @Throttle(STRICT_AUTH_THROTTLE)
  @AllowAnonymous()
  @Post('reset-password')
  resetPassword(@Body() body: ResetPasswordDto, @GetHeaders() headers: Headers) {
    return this.auth.api.resetPassword({ body, headers });
  }

  @ApiDoc(changePasswordDoc)
  @Post('change-password')
  changePassword(@Body() body: ChangePasswordDto, @GetHeaders() headers: Headers) {
    return this.auth.api.changePassword({ body, headers });
  }

  @ApiDoc(verifyEmailDoc)
  @AllowUnverified()
  @Post('verify-email')
  sendVerification(
    @Session() session: ISession,
    @Body() body: VerifyEmailDto,
    @GetHeaders() headers: Headers,
  ) {
    return this.auth.api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: body.callbackURL },
      headers,
    });
  }

  @ApiDoc(verifyEmailCallbackDoc)
  @AllowAnonymous()
  @AllowUnverified()
  @Get('verify')
  async verify(
    @Query('token') token: string,
    @Query('callbackURL') callbackURL: string | undefined,
    @Res() res: FastifyReply,
  ) {
    if (!callbackURL || !isTrustedCallbackURL(callbackURL)) {
      throw new BadRequestError({ message: 'callbackURL inválida ou não permitida' });
    }

    await this.auth.api.verifyEmail({ query: { token } });

    return res.status(302).redirect(callbackURL);
  }
}
