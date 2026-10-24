import { describe, expect, it } from 'vitest';
import { withSpoilers } from './Markdown';

describe('withSpoilers', () => {
  it('wraps ||text|| in a spoiler span', () => {
    expect(withSpoilers('Uli ||dies|| at the end')).toBe('Uli <span class="spoiler" tabindex="0">dies</span> at the end');
  });
  it('leaves code and lone bars alone', () => {
    expect(withSpoilers('`a || b` and a | b')).toBe('`a || b` and a | b');
    expect(withSpoilers('||one|| and `||two||`')).toBe('<span class="spoiler" tabindex="0">one</span> and `||two||`');
  });
});
