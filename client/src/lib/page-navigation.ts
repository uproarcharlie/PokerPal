/**
 * Full page loads (not client-side route changes), behind one object so component tests can replace
 * them: jsdom cannot navigate, and its `location` methods cannot be spied on.
 */
export const pageNavigation = {
  reload: (): void => window.location.reload(),
  assign: (url: string): void => window.location.assign(url),
};
