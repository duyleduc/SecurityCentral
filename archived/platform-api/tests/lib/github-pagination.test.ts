import { describe, it, expect } from 'vitest';

import { parseLinkHeaderNext } from '../../src/lib/github.js';

describe('GitHub Link Header Pagination', () => {
  it('extracts next URL from Link header', () => {
    const header = '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next", <https://api.github.com/installation/repositories?per_page=100&page=5>; rel="last"';
    expect(parseLinkHeaderNext(header)).toBe('https://api.github.com/installation/repositories?per_page=100&page=2');
  });

  it('returns null when no next link', () => {
    const header = '<https://api.github.com/repos?page=1>; rel="prev", <https://api.github.com/repos?page=1>; rel="first"';
    expect(parseLinkHeaderNext(header)).toBeNull();
  });

  it('returns null for null header', () => {
    expect(parseLinkHeaderNext(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseLinkHeaderNext('')).toBeNull();
  });

  it('handles single next link without other rels', () => {
    const header = '<https://api.github.com/repos?page=3>; rel="next"';
    expect(parseLinkHeaderNext(header)).toBe('https://api.github.com/repos?page=3');
  });
});
