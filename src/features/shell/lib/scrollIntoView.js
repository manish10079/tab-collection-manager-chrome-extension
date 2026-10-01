/**
 * Scroll an element into view, tolerating environments without layout (jsdom leaves
 * `Element.prototype.scrollIntoView` undefined). The shell uses this for the 1-9 jump shortcut and
 * for opening a collection out of the search results.
 *
 * @param {Element|null} element
 * @param {ScrollIntoViewOptions} [options]
 * @returns {void}
 */
export function scrollIntoView(element, options) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView(options);
}
