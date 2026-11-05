// SILO app demo: records the real app end to end on a local Robinhood Chain (anvil, chain 4663) with the real SiloRollup contract:
// create keys → deposit ETH from an EVM wallet → private send → withdraw → batch posted → explorer verifies the tx in the browser.
// node _studio/demo.cjs  → brand/silo-app-demo.mp4
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFileSync } = require('child_process'), { open, sleep } = require('./cdp.cjs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'brand', 'silo-app-demo.mp4'), FR = path.join(os.tmpdir(), 'silo-demo-frames'), W = 1280, H = 720, PORT = 8279;
const FB = path.join(os.homedir(), '.foundry', 'bin'), bin = (n) => path.join(FB, n + (process.platform === 'win32' ? '.exe' : ''));
const RPC = 'http://127.0.0.1:8547', DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', SEQK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', USER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

// EVM wallet in the page: forwards to the local chain, where anvil's account #2 is unlocked (every tx is a real on-chain tx there)
const EVM = `(() => { const rpc = (m, p) => fetch('${RPC}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p || [] }) }).then((r) => r.json()).then((j) => { if (j.error) throw j.error; return j.result; });
  window.ethereum = { isMetaMask: true, request: async ({ method, params }) => { if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['${USER}']; if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'eth_sendTransaction') { await new Promise((r) => setTimeout(r, 900)); } return rpc(method, params); } }; })();`;
const CAP = `(() => { const d=document.createElement('div');d.id='__cap';d.style.cssText='position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:99999;padding:14px 26px;background:#05060a;border:1px solid rgba(241,196,106,.7);box-shadow:0 0 40px rgba(241,196,106,.25);font:400 16px "IBM Plex Mono",monospace;letter-spacing:.06em;color:#ebe5d6;white-space:nowrap;opacity:0;transition:opacity .3s';
  const c=document.createElement('div');c.id='__cur';c.style.cssText='position:fixed;z-index:99998;width:22px;height:22px;border-radius:50%;border:2px solid #f1c46a;background:rgba(241,196,106,.2);pointer-events:none;transform:translate(-50%,-50%);transition:left .55s cubic-bezier(.3,.7,.3,1),top .55s cubic-bezier(.3,.7,.3,1);left:800px;top:450px';
  document.body.append(d,c); })();`;

(async () => {
  fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const anvil = spawn(bin('anvil'), ['--port', '8547', '--chain-id', '4663', '--block-time', '1', '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' })).ok) break; } catch {} await sleep(300); }
  const ROLLUP = execFileSync(bin('forge'), ['create', 'src/SiloRollup.sol:SiloRollup', '--rpc-url', RPC, '--private-key', DEPLOYER, '--broadcast', '--constructor-args', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'], { cwd: path.join(ROOT, 'contracts') }).toString().match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1];
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_PATH: path.join(os.tmpdir(), 'silo-demo-' + Date.now() + '.json'), RH_RPC: RPC, ROLLUP, SEQ_KEY: SEQK, BLOCK_SEC: '2', BATCH_SEC: '600', L1_POLL_SEC: '2' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/stats`)).ok) break; } catch {} await sleep(300); }
  const { wallet } = await import('../client/rct.js'); const BOB = wallet().qaddress;   // a second SILO wallet to pay
  const c = await open('about:blank', W, H, 9900 + Math.floor(Math.random() * 90));
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: EVM });
  const frames = []; let rec = false;
  c.on('Page.screencastFrame', (p) => { if (rec) { const f = path.join(FR, 'f' + String(frames.length).padStart(5, '0') + '.jpg'); fs.writeFileSync(f, Buffer.from(p.data, 'base64')); frames.push({ f, t: p.metadata.timestamp * 1000 }); } c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); });
  const go = async (p) => { await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` }); await sleep(2600); await c.ev('document.fonts.ready.then(()=>1)'); await c.ev(CAP); };
  const cap = (s) => c.ev(`(()=>{const d=document.getElementById('__cap');d.innerHTML=${JSON.stringify(s)};d.style.opacity=1})()`);
  const at = async (sel) => { await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center',behavior:'smooth'})})()`); await sleep(700); await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect();const k=document.getElementById('__cur');k.style.left=(r.left+r.width/2)+'px';k.style.top=(r.top+r.height/2)+'px'})()`); await sleep(650); };
  const click = async (sel) => { await at(sel); await c.ev(`(()=>{const k=document.getElementById('__cur');k.style.background='rgba(241,196,106,.8)';setTimeout(()=>k.style.background='rgba(241,196,106,.2)',180);document.querySelector(${JSON.stringify(sel)}).click()})()`); await sleep(350); };
  const type = async (sel, txt, fast) => { await click(sel); const step = fast ? Math.ceil(txt.length / 18) : 1; for (let i = step; i < txt.length + step; i += step) { await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(txt)}.slice(0,${i});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(fast ? 40 : 110); } await sleep(400); };
  const until = async (js, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await c.ev(js)) return true; await sleep(400); } return false; };

  await go('/');
  await c.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); rec = true;
  await cap('silonetwork.org · <b style="color:#f1c46a">a private layer 2 on Robinhood Chain</b>'); await sleep(3800);
  await go('/wallet'); await cap('1 · create SILO keys · made in your browser, never sent anywhere'); await sleep(1200); await click('#mk'); await sleep(2200);
  await cap('2 · deposit 0.25 ETH into SiloRollup from your EVM wallet'); await type('#damt', '0.25'); await click('#dep'); await sleep(1500);
  await cap('2 · the node reads the deposit and mints it to your quantum address');
  await until(`document.getElementById('bal').textContent === '0.25'`, 30000); await at('#bal'); await sleep(2400);
  await cap('3 · send 0.1 ETH privately · ring of 16, hidden amount'); await click('[data-p=send]'); await type('#to', BOB, true); await type('#amt', '0.1'); await click('#send');
  await until(`/sent privately/.test(document.getElementById('prog').textContent)`, 30000); await sleep(2600);
  await cap('4 · withdraw 0.05 ETH to a 0x address on Robinhood Chain'); await click('[data-p=wd]'); await type('#wto', '0x000000000000000000000000000000000000c0de', true); await type('#wamt', '0.05'); await click('#wd');
  await until(`/withdrawal accepted/.test(document.getElementById('wprog').textContent)`, 30000); await sleep(2400);
  const wid = await c.ev(`(document.querySelector('#wprog a')||{}).href`);
  await sleep(6000);   // the exit triggers a batch; the contract pays it
  await go('/explorer'); await cap('5 · the explorer: the batch posted to SiloRollup, the deposit in, the withdrawal paid'); await sleep(1500);
  await c.ev(`window.scrollTo({top:document.body.scrollHeight*.42,behavior:'smooth'})`); await sleep(4200);
  await go('/explorer#/tx/' + wid.split('/tx/')[1]); await cap('6 · the withdrawal: a private tx with one public exit, paid by the contract'); await sleep(3200);
  await cap('7 · verify it yourself · your browser re-runs the ring signatures and range proofs'); await click('#verify');
  await until(`/verified/.test((document.getElementById('vres')||{}).textContent||'')`, 20000); await at('#vres'); await sleep(3200);
  await go('/'); await cap('silonetwork.org · @SiloNetworkRH · <b style="color:#f1c46a">$SILO</b>'); await sleep(3600);
  await sleep(300); rec = false; await c.send('Page.stopScreencast');
  frames.sort((a, b) => a.t - b.t);
  const list = frames.map((x, i) => `file '${x.f.split(path.sep).join('/')}'\nduration ${Math.max(0.01, ((frames[i + 1] || x).t - x.t) / 1000 || 0.05).toFixed(3)}`).join('\n') + `\nfile '${frames[frames.length - 1].f.split(path.sep).join('/')}'`;
  fs.writeFileSync(path.join(FR, 'list.txt'), list);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(FR, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', OUT]);
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/stats`)).json();
  console.log('OK', OUT, frames.length, 'frames', ((frames.at(-1).t - frames[0].t) / 1000).toFixed(1) + 's', JSON.stringify({ deposits: s.deposits, privateTxs: s.privateTxs, batches: s.batches, exitsPaid: s.exitsPaid }));
  c.close(); srv.kill(); anvil.kill(); fs.rmSync(FR, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
