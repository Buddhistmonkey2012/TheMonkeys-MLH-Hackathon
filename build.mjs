import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { files, headersFor } from './assets.mjs';

await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
const output = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([route, name]) => [
  route, { body: await readFile('web/' + name, 'utf8'), headers: headersFor(name) },
])));
const api = (await readFile('matching.js', 'utf8')) + (await readFile('api.js', 'utf8')).replace(/^import[^\n]*\n/,'');
const worker = `
const files = ${JSON.stringify(output)};
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return handleApi(request, env);
    const asset = Object.hasOwn(files, path) && files[path];
    if (!asset) return new Response('Not found', {status:404});
    return new Response(asset.body, {headers:asset.headers});
  },
};
`;
await writeFile('dist/server/index.js', api + worker);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
