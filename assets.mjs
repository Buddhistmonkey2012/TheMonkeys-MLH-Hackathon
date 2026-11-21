export const files = {
  '/': 'index.html',
  '/styles.css': 'styles.css',
  '/app.js': 'app.js',
  '/accounts.js': 'accounts.js',
  '/icons.js': 'icons.js',
  '/mark.svg': 'mark.svg',
};
const mime = {html:'text/html', css:'text/css', js:'text/javascript', svg:'image/svg+xml'};
export const headersFor = name => ({
  'Content-Type': mime[name.split('.').pop()] + '; charset=utf-8',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'",
  'Cache-Control':'no-cache',
});
