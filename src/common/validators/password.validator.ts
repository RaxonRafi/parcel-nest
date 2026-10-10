import { applyDecorators } from '@nestjs/common';
import { IsString, IsStrongPassword, MaxLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../constants/validation.constants';

export const PASSWORD_RULES = `at least ${PASSWORD_MIN_LENGTH} characters with an uppercase letter, a lowercase letter and a number`;

/**
 * The rule for a password someone is choosing — registration, change and
 * reset. Never put it on a login field: an account created under an older,
 * looser rule must still be able to sign in.
 *
 * Symbols are welcome but not demanded; forcing them mostly produces
 * `Password1!`. Length and three character classes rule out the worst
 * choices without that. The upper bound is bcrypt's: it ignores everything
 * past 72 bytes, so a longer password would be silently truncated.
 */
export function IsNewPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(72, { message: 'Password must be at most 72 characters' }),
    IsStrongPassword(
      {
        minLength: PASSWORD_MIN_LENGTH,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 0,
      },
      { message: `Password must be ${PASSWORD_RULES}` },
    ),
  );
}
