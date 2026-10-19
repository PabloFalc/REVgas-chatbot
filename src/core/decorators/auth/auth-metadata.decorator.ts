import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const IS_ALLOW_ANONYMOUS = 'isAllowAnonymous';
export const AllowAnonymous = () => SetMetadata(IS_ALLOW_ANONYMOUS, true);

export const IS_ALLOW_UNVERIFIED = 'isAllowUnverified';
export const AllowUnverified = () => SetMetadata(IS_ALLOW_UNVERIFIED, true);
