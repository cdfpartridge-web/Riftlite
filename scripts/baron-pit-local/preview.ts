/** Local review of a public recording using the actual replay player. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import type { CanonicalReplayV2 } from '../../src/lib/replay-v2';

const replayId = 'rl2_1e5eff0d8d8deec72ca431573144e452';
const beforeSeconds = 769.088;
const createdSeconds = 770.841;
const watchSeconds = 767;

async function main() {
  const args = process.argv.slice(2);
  const buildOnly = args.includes('--build-only');
  const portIndex = args.indexOf('--port');
  const port = Number(portIndex < 0 ? 4200 : args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
  const project = process.cwd();
  const output = resolve(project, 'output/baron-pit-local');
  const publicRoot = resolve(project, 'public');
  const fixturePath = resolve(project, '../../output/baron-pit-replay-20260920', `${replayId}.canonical.json`);
  const fixtureBytes = await readFile(fixturePath);
  const replay = JSON.parse(fixtureBytes.toString('utf8')) as CanonicalReplayV2;
  if (replay.schema !== 'riftlite-canonical-replay' || replay.version !== 2 || replay.events[694]?.atMs !== 770841) {
    throw new Error('Expected the selected public Shen vs Mel recording.');
  }
  await mkdir(output, { recursive: true });
  const replayPlayer = join(project, 'src/components/replay-v2/ReplayV2Player.tsx').replace(/\\/g, '/');
  await writeFile(join(output, 'entry.jsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ReplayV2Player } from ${JSON.stringify(replayPlayer)};
    if (!new URLSearchParams(location.search).has('t')) history.replaceState(null, '', '?t=${createdSeconds}');
    createRoot(document.getElementById('root')).render(<>
      <header className="review-header">
        <div><strong>Baron Pit replay review</strong><span className="local-badge">LOCAL · NOT DEPLOYED</span></div>
        <nav aria-label="Review moments">
          <a href="/?t=${beforeSeconds}">Before Baron</a>
          <a href="/?t=${createdSeconds}">Baron Pit appears</a>
          <a href="/?t=${watchSeconds}">Watch creation</a>
        </nav>
      </header>
      <p className="review-intro">Shenobi (Shen) vs JM (Mel) · Game 1, turn 14 · Baron enters at 12:50.841. Choose “Watch creation”, then press Play. <a href="https://www.riftlite.com/replays/${replayId}?t=${createdSeconds}" target="_blank" rel="noreferrer">Original public replay</a></p>
      <main className="review-main"><ReplayV2Player replayId=${JSON.stringify(replayId)} apiBasePath="/fixture/replays" /></main>
    </>);
  `);
  const aliases: Record<string, string> = {
    'next/link': 'local-link.tsx',
    'next/router': 'local-router.ts',
    'firebase/auth': 'local-auth.ts',
    '@/lib/firebase/client': 'local-auth.ts',
  };
  const result = await build({
    absWorkingDir: project,
    entryPoints: [join(output, 'entry.jsx')],
    outfile: join(output, 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    jsx: 'automatic',
    tsconfig: join(project, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
    alias: { react: join(project, 'node_modules/react'), 'react-dom': join(project, 'node_modules/react-dom') },
    plugins: [{
      name: 'local-preview-services',
      setup(builder) {
        builder.onResolve({ filter: /^(next\/link|next\/router|firebase\/auth|@\/lib\/firebase\/client)$/ },
          ({ path }) => ({ path: join(project, 'scripts/baron-pit-local', aliases[path]) }));
      },
    }],
  });
  if (Object.keys(result.metafile!.inputs).some(file => /node_modules[\\/](?:firebase|@firebase|next)[\\/]/.test(file))) {
    throw new Error('Local preview unexpectedly includes account services.');
  }
  await writeFile(join(output, 'bundle-meta.json'), JSON.stringify(result.metafile));
  const report = {
    replayId, fixturePath, events: replay.events.length,
    originalPublicUrl: `https://www.riftlite.com/replays/${replayId}`,
    beforeSeconds, createdSeconds, watchSeconds,
    beforeEventIndex: 693, createdEventIndex: 694,
    deployment: 'local-only',
  };
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
    <title>RiftLite · Baron Pit replay review</title><link rel="stylesheet" href="/bundle.css"><style>
    *{box-sizing:border-box}body{margin:0;background:#090d18;color:#e9f3ff;font:14px/1.5 system-ui,sans-serif}a{color:#ade6f1;text-decoration:none}.review-header{padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #29384c}.review-header>div{display:flex;align-items:center;gap:14px}.local-badge{font-size:10px;letter-spacing:.08em;color:#f4cf80}.review-header nav{display:flex;gap:8px;font-size:12px}.review-header nav a{padding:6px 10px;border:1px solid #33475f;border-radius:6px;background:#142136}.review-header nav a:hover{background:#203750}.review-intro{margin:9px 20px;color:#a8b8cc;font-size:12px}.review-intro a{margin-left:8px}.review-main{padding:0 12px 12px}.review-main>:first-child{position:relative;height:calc(100dvh - 104px);min-height:380px}@media(max-width:800px){.review-header{align-items:flex-start;flex-direction:column;padding:10px 12px;gap:8px}.review-header>div{gap:8px}.review-intro{margin:8px 12px}.review-main{padding:0}.review-main>:first-child{height:calc(100dvh - 160px);min-height:380px}}
    </style></head><body><div id="root"></div><script src="/bundle.js" defer></script></body></html>`);
  if (buildOnly) { console.log(JSON.stringify({ built: output, ...report }, null, 2)); return; }
  const outputFiles: Record<string, string> = {
    '/': 'index.html', '/replay': 'index.html', '/replays': 'index.html',
    [`/replays/${replayId}`]: 'index.html', '/bundle.js': 'bundle.js', '/bundle.css': 'bundle.css',
  };
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.webp': 'image/webp',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const respond = (contents: Buffer | string, contentType: string) => {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', Buffer.byteLength(contents));
      res.end(req.method === 'HEAD' ? undefined : contents);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url || '/', `http://127.0.0.1:${port}`).pathname); }
    catch { res.statusCode = 400; res.end(); return; }
    if (pathname === `/fixture/replays/${replayId}`) return respond(fixtureBytes, 'application/json');
    if (pathname === `/fixture/replays/${replayId}/decks`) return respond('{"history":null}', 'application/json');
    if (pathname === '/fixture/verification') return respond(JSON.stringify(report), 'application/json');
    let filePath: string | null = outputFiles[pathname] ? join(output, outputFiles[pathname]) : null;
    if (!filePath && /\.(?:mp3|wav|png|webp|jpg|jpeg|avif|svg|ico)$/i.test(pathname)) {
      const candidate = resolve(publicRoot, `.${pathname}`);
      if (candidate.toLowerCase().startsWith((publicRoot + sep).toLowerCase())) filePath = candidate;
    }
    if (!filePath) { res.statusCode = 404; res.end(); return; }
    try { respond(await readFile(filePath), mime[extname(filePath).toLowerCase()] || 'application/octet-stream'); }
    catch (error) {
      res.statusCode = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
      res.end('Local preview file unavailable.');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/?t=${createdSeconds}`, ...report }, null, 2)));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
