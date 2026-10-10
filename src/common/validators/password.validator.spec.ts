import { validate } from 'class-validator';
import { IsNewPassword } from './password.validator';

class Form {
  @IsNewPassword()
  password!: unknown;
}

const errorsFor = async (password: unknown): Promise<string[]> => {
  const form = Object.assign(new Form(), { password });
  const errors = await validate(form);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('IsNewPassword', () => {
  it.each(['Passw0rd', 'SeedPass123!', 'correct Horse 9 battery'])(
    'accepts %p',
    async (password) => {
      await expect(errorsFor(password)).resolves.toEqual([]);
    },
  );

  it.each([
    ['too short', 'Pw0rd'],
    ['no uppercase letter', 'passw0rd'],
    ['no lowercase letter', 'PASSW0RD'],
    ['no number', 'Password'],
  ])('rejects a password with %s', async (_why, password) => {
    const errors = await errorsFor(password);

    expect(errors.join(' ')).toMatch(/at least 8 characters/);
  });

  it('rejects one longer than bcrypt can hash', async () => {
    const errors = await errorsFor(`Aa1${'x'.repeat(80)}`);

    expect(errors.join(' ')).toMatch(/at most 72/);
  });

  it('rejects something that is not a string', async () => {
    await expect(errorsFor(12345678)).resolves.not.toEqual([]);
  });
});
