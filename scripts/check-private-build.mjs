import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../dist/us/', import.meta.url);
async function check(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const location = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
    if (item.isDirectory()) { await check(location); continue; }
    if (!item.name.endsWith('.html')) continue;
    const html = await readFile(location, 'utf8');
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const source = script[1].match(/\bsrc="([^"]+)"/i)?.[1];
      if (!source?.startsWith('/_astro/') || script[2].trim()) throw new Error(`Private-page script violates the deployed CSP: ${location.pathname}`);
    }
  }
}
await check(root);
console.log('Private-page scripts are compatible with the deployed security policy.');
