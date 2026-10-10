import { extractBearerToken } from './jwt.util';

describe('extractBearerToken', () => {
  it('returns the token from a Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it.each([undefined, '', 'abc.def.ghi', 'Basic abc', 'Bearer', 'Bearer a b'])(
    'treats %p as no token',
    (header) => {
      expect(extractBearerToken(header)).toBeUndefined();
    },
  );
});
