// api/verify-turnstile.mjs 行为测试（无依赖，node tests/verify-turnstile.test.mjs）
// 覆盖：无 secret→500 / 非 POST→405 / 缺 token→400 / 非法 JSON→400 /
//       成功分支（URL 与 secret+response 注入）/ 验证失败→200+success:false / 上游失败→502
import { default as handler } from '../api/verify-turnstile.mjs';

const results = [];
function check(name, cond) { results.push([name, cond]); }

function makeReq(method = 'POST', bodyChunks = []) {
  return {
    method,
    headers: {},
    [Symbol.asyncIterator]: async function* () { for (const c of bodyChunks) yield c; },
  };
}
function makeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; },
  };
}

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init.body });
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

const oldSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET;

// 1) 无 secret → 500
delete process.env.CLOUDFLARE_TURNSTILE_SECRET;
let res = makeRes();
await handler(makeReq('POST', [Buffer.from(JSON.stringify({ token: 'T1' }))]), res);
check('无 secret 返回 500', res.statusCode === 500);

// 2) 非 POST → 405
process.env.CLOUDFLARE_TURNSTILE_SECRET = 'SECRET_X';
res = makeRes();
await handler(makeReq('GET'), res);
check('GET 返回 405', res.statusCode === 405);

// 3) 缺 token → 400
res = makeRes();
await handler(makeReq('POST', [Buffer.from(JSON.stringify({}))]), res);
check('缺 token 返回 400', res.statusCode === 400);

// 4) 非法 JSON → 400
res = makeRes();
await handler(makeReq('POST', [Buffer.from('not-json')]), res);
check('非法 JSON 返回 400', res.statusCode === 400);

// 5) 成功路径：token 传递 + secret 注入 + 响应
calls.length = 0;
res = makeRes();
await handler(makeReq('POST', [Buffer.from(JSON.stringify({ token: 'TOKEN_ABC' }))]), res);
check('成功返回 200 success:true', res.statusCode === 200 && res.body.success === true);
check('siteverify URL 正确', calls[0] && calls[0].url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
check('请求体含 secret 与 response', calls[0] && calls[0].body.includes('secret=SECRET_X') && calls[0].body.includes('response=TOKEN_ABC'));

// 6) siteverify 返回 success:false → 200 + success:false + codes
globalThis.fetch = async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 });
res = makeRes();
await handler(makeReq('POST', [Buffer.from(JSON.stringify({ token: 'BAD' }))]), res);
check('验证失败返回 200 success:false + codes', res.statusCode === 200 && res.body.success === false && res.body.codes[0] === 'invalid-input-response');

// 7) 上游网络失败 → 502
globalThis.fetch = async () => { throw new Error('network'); };
res = makeRes();
await handler(makeReq('POST', [Buffer.from(JSON.stringify({ token: 'T' }))]), res);
check('上游失败返回 502', res.statusCode === 502);

process.env.CLOUDFLARE_TURNSTILE_SECRET = oldSecret;
globalThis.fetch = realFetch;

let failed = 0;
for (const [name, ok] of results) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) failed++; }
console.log(failed === 0 ? 'ALL_PASS' : 'FAILED=' + failed);
process.exit(failed === 0 ? 0 : 1);
