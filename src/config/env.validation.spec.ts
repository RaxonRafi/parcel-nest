import { Logger } from '@nestjs/common';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    JWT_ACCESS_EXPIRES: '15m',
    JWT_REFRESH_EXPIRES: '7d',
    BCRYPT_SALT_ROUND: '10',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('passes a complete environment through untouched', () => {
    expect(validateEnv(valid)).toBe(valid);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts discrete database values in place of a URL', () => {
    const { DATABASE_URL: _url, ...rest } = valid;

    expect(() =>
      validateEnv({
        ...rest,
        DB_HOST: 'localhost',
        DB_USERNAME: 'postgres',
        DB_NAME: 'percel',
      }),
    ).not.toThrow();
  });

  it('reports every problem at once', () => {
    expect(() => validateEnv({ JWT_ACCESS_EXPIRES: 'soon' })).toThrow(
      /JWT_ACCESS_SECRET is required[\s\S]*JWT_REFRESH_SECRET is required[\s\S]*JWT_ACCESS_EXPIRES must look like[\s\S]*BCRYPT_SALT_ROUND is required[\s\S]*DATABASE_URL/,
    );
  });

  it('names the database values that are missing', () => {
    const { DATABASE_URL: _url, ...rest } = valid;

    expect(() => validateEnv({ ...rest, DB_HOST: 'localhost' })).toThrow(
      /missing DB_USERNAME, DB_NAME/,
    );
  });

  it.each(['0', '3', '16', 'ten'])('rejects a salt round of %p', (value) => {
    expect(() => validateEnv({ ...valid, BCRYPT_SALT_ROUND: value })).toThrow(
      /BCRYPT_SALT_ROUND/,
    );
  });

  it('rejects a port that is not a number', () => {
    expect(() => validateEnv({ ...valid, PORT: 'http' })).toThrow(/PORT/);
  });

  it('only warns about a weak secret, so an existing deploy still boots', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('JWT_ACCESS_SECRET looks weak'),
    );
  });

  it('warns when the two secrets are the same', () => {
    validateEnv({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('identical'));
  });

  it('warns when the assistant is half configured', () => {
    validateEnv({ ...valid, PINECONE_API_KEY: 'key' });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('only some are set'),
    );
  });
});
