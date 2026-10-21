import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

test("actual Worker runtime accepts monitoring requests and rejects redirects without forwarding credentials", async () => {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = await import(
    pathToFileURL(wranglerRequire.resolve("miniflare")).href
  );
  const { outputFiles } = await build({
    stdin: {
      resolveDir: resolve("cloudflare"),
      contents: `
        import { collectPerformance } from './monitor-journal.mjs';
        import { developmentActivity } from './owner-monitor.mjs';
        import { verifyTelemetryToken } from './monitor-telemetry.mjs';
        export default { async fetch() {
          const now = Date.now(), modes = [];
          const request = (url, options) => {
            const req = new Request(url, options); // Actual workerd constructor, not Node's implementation.
            modes.push(req.redirect);
            return req;
          };
          const DB = { prepare() { return { bind() { return this; }, async run() { return {}; } }; } };
          const performance = await collectPerformance(DB, now, async (url, options) => {
            request(url, options);
            return new Response(url.endsWith('state.json') ? JSON.stringify({scanAfter:new Date(now).toISOString(),pending:[]}) : '');
          });
          let performanceRedirect;
          try { await collectPerformance(DB, now, async (url, options) => {
            request(url, options);
            return new Response(null, {status:302,headers:{location:'https://example.invalid/'}});
          }); } catch(e) { performanceRedirect=e.providerCode; }
          const github = await developmentActivity({DB:{},OWNER_MONITOR_GITHUB:'true',OWNER_MONITOR_GITHUB_TOKEN:'synthetic'}, async (url, options) => {
            request(url, options);
            return new Response(null,{status:302,headers:{location:'https://example.invalid/'}});
          });
          const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
          const jwk={...await crypto.subtle.exportKey('jwk',key.publicKey),kid:'runtime',use:'sig'};
          const encoded=v=>btoa(typeof v==='string'?v:JSON.stringify(v)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
          const claims={iss:'https://token.actions.githubusercontent.com',aud:'https://lootsplit.oliverstorie2017.workers.dev/monitoring',repository:'UnregisteredMusket/Lootsplit',repository_id:'1398794793',repository_owner_id:'336285553',ref:'refs/heads/main',sub:'repo:UnregisteredMusket@336285553/Lootsplit@1398794793:ref:refs/heads/main',workflow_ref:'UnregisteredMusket/Lootsplit/.github/workflows/verify.yml@refs/heads/main',event_name:'push',run_id:'123',run_attempt:'1',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+300};
          const payload=encoded({alg:'RS256',typ:'JWT',kid:'runtime'})+'.'+encoded(claims);
          const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(payload));
          const token=payload+'.'+encoded(String.fromCharCode(...new Uint8Array(signed)));
          const accepted=await verifyTelemetryToken(token,{DB:{}},now,async(url,options)=>{
            request(url,options);return Response.json({keys:[jwk]});
          });
          let signingRedirect;
          try { await verifyTelemetryToken(token,{DB:{}},now,async(url,options)=>{
            request(url,options);return new Response(null,{status:302,headers:{location:'https://example.invalid/'}});
          }); } catch(e) { signingRedirect=e.status; }
          return Response.json({modes,performanceCount:performance.count,performanceRedirect,github:github.errorCode,accepted:accepted.run_id,signingRedirect});
        }};
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:*"],
  });
  const options = {
    modules: true,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    script: outputFiles[0].text,
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  try {
    const response = await mf.dispatchFetch("http://runtime.test/");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.modes.length >= 10);
    assert.deepEqual([...new Set(result.modes)], ["manual"]);
    assert.equal(result.performanceCount, 0);
    assert.equal(result.performanceRedirect, "HTTP_302");
    assert.equal(result.github, "HTTP_302");
    assert.equal(result.accepted, "123");
    assert.equal(result.signingRedirect, 503);
  } finally {
    await mf.dispose();
  }
});
