// The extension id never changes for the life of a page. It lives in `shared/` because more than
// one feature needs it for favicon URLs, and `lib/url.js` deliberately stays free of `chrome.*`
// by taking it as an argument (skill.md §3.3).
export const EXTENSION_ID =
  typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome.runtime.id : '';
