export function allowedDownload(value, source) {
  const url = new URL(value), prefix = new URL(source.distributionPrefix);
  if (url.protocol !== 'https:' || url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname) ||
      url.username || url.password || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) {
    throw new Error('Update URL is outside the pinned official distribution');
  }
  return url.toString();
}
