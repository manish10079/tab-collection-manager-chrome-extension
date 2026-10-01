import { describe, expect, it } from 'vitest';
import { resolveFaviconUrl, toOpenableUrl, truncateUrl } from '../url.js';
import { resolveTabGroupBadge, resolveTabGroupColor } from '../tabGroups.js';

describe('resolveFaviconUrl', () => {
  it('uses the extension favicon endpoint for http(s) URLs', () => {
    expect(resolveFaviconUrl('https://example.com/a', 'abc')).toBe(
      'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa&size=32'
    );
  });

  it('falls back for missing URLs, non-http protocols and a missing extension id', () => {
    expect(resolveFaviconUrl('', 'abc')).toBe('icons/icon16.png');
    expect(resolveFaviconUrl('chrome://extensions', 'abc')).toBe('icons/icon16.png');
    expect(resolveFaviconUrl('https://example.com', '')).toBe('icons/icon16.png');
    expect(resolveFaviconUrl('not a url', 'abc')).toBe('icons/icon16.png');
  });
});

describe('truncateUrl', () => {
  it('only shortens URLs longer than the limit', () => {
    expect(truncateUrl('https://a.test', 50)).toBe('https://a.test');
    expect(truncateUrl('x'.repeat(60), 50)).toBe(`${'x'.repeat(50)}...`);
  });
});

describe('toOpenableUrl', () => {
  it('adds a scheme and rejects empty values', () => {
    expect(toOpenableUrl('example.com')).toBe('https://example.com');
    expect(toOpenableUrl('http://example.com')).toBe('http://example.com');
    expect(toOpenableUrl('   ')).toBeNull();
    expect(toOpenableUrl(undefined)).toBeNull();
  });
});

describe('tab group helpers', () => {
  it('maps Chrome colour names onto the palette with a grey fallback', () => {
    expect(resolveTabGroupColor('blue')).toBe('#1a73e8');
    expect(resolveTabGroupColor('nonsense')).toBe('#5f6368');
  });

  it('hides the badge for ungrouped tabs and shows the group name otherwise', () => {
    const collection = {
      id: 'c',
      name: 'c',
      tabs: [],
      chromeGroups: { 7: { title: 'Work', color: 'red' } },
    };

    expect(resolveTabGroupBadge({ id: 't', chromeGroupId: null }, collection).visible).toBe(false);
    expect(resolveTabGroupBadge({ id: 't', chromeGroupId: 9 }, collection).visible).toBe(false);

    const badge = resolveTabGroupBadge({ id: 't', chromeGroupId: 7 }, collection);
    expect(badge).toEqual({
      visible: true,
      color: '#d93025',
      label: 'Work',
      title: 'Chrome tab group: Work',
    });
  });

  it('keeps an untitled group visible with an empty label', () => {
    const collection = {
      id: 'c',
      name: 'c',
      tabs: [],
      chromeGroups: { 3: { title: '  ', color: 'cyan' } },
    };
    const badge = resolveTabGroupBadge({ id: 't', chromeGroupId: 3 }, collection);
    expect(badge.visible).toBe(true);
    expect(badge.label).toBe('');
    expect(badge.title).toBe('Chrome tab group');
  });
});
