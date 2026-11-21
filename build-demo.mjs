import { readFile, writeFile } from 'node:fs/promises';
import { builtInSuggestions } from './api.js';
import { createOfflineApi } from './offline.js';
import { mentorMatches } from './matching.js';

const to = process.argv[2];
if (!to) throw new Error('Pass an output HTML path.');
const fixture = {createdAt:Date.now(),people:[],threads:[],events:[],readReminders:{}};
const [index, css, mark, icons, accounts, app] = await Promise.all(
  ['index.html','styles.css','mark.svg','icons.js','accounts.js','app.js'].map(name => readFile(new URL('web/' + name,import.meta.url),'utf8')));
const logo = 'data:image/svg+xml;base64,' + Buffer.from(mark).toString('base64');
const client = [
  mentorMatches.toString(),
  'globalThis.techWomenDemo = (' + createOfflineApi.toString() + ')(' + JSON.stringify(fixture) + ',(' + builtInSuggestions.toString() + '),undefined,mentorMatches);',
  icons.replace('export const icon','const icon'),
  accounts.replaceAll('export function','function'),
  app.replace(/^import[^\n]*\n/gm,''),
].join('\n').replaceAll('/mark.svg',logo).replaceAll('</script','<\\/script');
const html = index.replace('/mark.svg',logo)
  .replace('<link rel="stylesheet" href="/styles.css">',() => '<style>\n' + css + '\n</style>')
  .replace('<script type="module" src="/app.js"></script>',() => '<script type="module">\n' + client + '\n</script>');
await writeFile(to,html);
