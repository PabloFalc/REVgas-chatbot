import { Body, Controller, Delete, Inject, Patch, Post } from '@nestjs/common';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { GetHeaders } from 'src/core/decorators/get-headers.decorator';
import { BadRequestError } from 'src/core/erros/http.errors';
import { BETTER_AUTH_TOKEN, type BetterAuth, isTrustedCallbackURL } from '../auth';
import { changeEmailDoc, deleteAccountDoc, updateProfileDoc } from './docs/user.doc';
import { ChangeEmailDto, DeleteAccountDto, UpdateProfileDto } from './dtos/user.dto';

@Controller({ path: 'me' })
export class UserController {
  constructor(@Inject(BETTER_AUTH_TOKEN) private readonly auth: BetterAuth) {}

  @ApiDoc(updateProfileDoc)
  @Patch()
  updateProfile(@Body() body: UpdateProfileDto, @GetHeaders() headers: Headers) {
    return this.auth.api.updateUser({ body, headers });
  }

  @ApiDoc(changeEmailDoc)
  @Post('change-email')
  changeEmail(@Body() body: ChangeEmailDto, @GetHeaders() headers: Headers) {
    if (!isTrustedCallbackURL(body.callbackURL)) {
      throw new BadRequestError({ message: 'callbackURL inválida ou não permitida' });
    }
    return this.auth.api.changeEmail({ body, headers });
  }

  @ApiDoc(deleteAccountDoc)
  @Delete()
  deleteAccount(@Body() body: DeleteAccountDto, @GetHeaders() headers: Headers) {
    return this.auth.api.deleteUser({ body, headers });
  }
}
