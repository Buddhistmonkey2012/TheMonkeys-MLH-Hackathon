import { readFile } from 'node:fs/promises';
import { handleApi } from './api.js';
import { files, headersFor } from './assets.mjs';
import { createAuth } from './auth.mjs';

export function createLocalApplication({DB, origin, accounts, env = {}}) {
  const auth = accounts ? createAuth({DB,origin,googleClientId:env.GOOGLE_CLIENT_ID,googleClientSecret:env.GOOGLE_CLIENT_SECRET}) : null;
  return async function handleRequest(request, ip) {
    const path = new URL(request.url).pathname;
    if (auth && path.startsWith('/auth/')) {
      const result = await auth.handle(request,ip);
      return result || new Response('Not found',{status:404});
    }
    if (path.startsWith('/api/')) {
      const context = auth
        ? {accounts:true,account:await auth.getAccount(request),googleAvailable:auth.googleAvailable}
        : {local:true};
      return handleApi(request,{...env,DB},context);
    }
    const file = Object.hasOwn(files,path) && files[path];
    return file
      ? new Response(await readFile(new URL('web/' + file,import.meta.url)),{headers:headersFor(file)})
      : new Response('Not found',{status:404});
  };
}
