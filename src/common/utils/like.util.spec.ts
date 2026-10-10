import { escapeLike } from './like.util';

describe('escapeLike', () => {
  it.each([
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
    ['TRK-2026', 'TRK-2026'],
    ['%_%', '\\%\\_\\%'],
  ])('%p → %p', (term, escaped) => {
    expect(escapeLike(term)).toBe(escaped);
  });
});
