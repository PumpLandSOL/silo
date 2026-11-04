// End to end against a local EVM (anvil, chain id 4663): deploy SiloRollup, boot the node, deposit real ETH from an EVM
// account to a SILO address, see it minted, send it privately, withdraw part of it back to Robinhood Chain, and watch
// the batch land on the contract and pay the exit.
import { spawn, execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, toHex, defineChain, parseEther } from 'viem'; import { privateKeyToAccount } from 'viem/accounts';
import * as K from '../client/rct.js';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), RPC = 'http://127.0.0.1:8546', PORT = 8273, API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
// anvil's well-known dev keys (local only)
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', SEQK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', USER = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const chain = defineChain({ id: 4663, name: 'local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const ABI = parseAbi(['function deposit(bytes l2addr) payable', 'function batches() view returns (uint64)', 'function totalExited() view returns (uint256)']);
const kids = []; const done = (code) => { kids.forEach((k) => { try { k.kill(); } catch {} }); process.exit(code); };
const get = (p) => fetch(API + p).then((r) => r.json()), post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
async function until(f, ms, what) { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(500); } }

try {
  kids.push(spawn('anvil', ['--port', '8546', '--chain-id', '4663', '--block-time', '1', '--silent'], { stdio: 'ignore' }));
  await until(() => pub.getChainId().then(() => true).catch(() => false), 20000, 'anvil');
  const seqAddr = privateKeyToAccount(SEQK).address;
  const out = execFileSync('forge', ['create', 'src/SiloRollup.sol:SiloRollup', '--rpc-url', RPC, '--private-key', DEPLOYER, '--broadcast', '--constructor-args', seqAddr], { cwd: path.join(ROOT, 'contracts') }).toString();
  const ROLLUP = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1]; ok(!!ROLLUP, 'SiloRollup deployed ' + ROLLUP);
  const DATA = path.join(os.tmpdir(), 'silo-e2e-' + Date.now() + '.json');
  kids.push(spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: DATA, RH_RPC: RPC, ROLLUP, SEQ_KEY: SEQK, BLOCK_SEC: '1', BATCH_SEC: '5', L1_POLL_SEC: '2' }, stdio: ['ignore', 'inherit', 'inherit'] }));
  await until(() => get('/api/stats').then((s) => s.height >= 1).catch(() => false), 20000, 'node');

  const alice = K.wallet(), bob = K.wallet(), user = createWalletClient({ chain, account: privateKeyToAccount(USER), transport: http(RPC) });
  const dep = await user.writeContract({ address: ROLLUP, abi: ABI, functionName: 'deposit', args: [toHex(alice.qaddress)], value: parseEther('0.5') });
  await pub.waitForTransactionReceipt({ hash: dep });
  // wallet scan, exactly like the browser wallet
  const scan = async (w) => { const r = await get('/api/outputs?from=0&limit=4000'); const mine = []; for (const o of r.outs) { const m = K.scan(w, o, o.R, o.i); if (m) mine.push({ ...m, g: o.g, P: o.P, C: o.C, ki: K.keyImage(m.x, o.P) }); }
    if (!mine.length) return []; const { spent } = await post('/api/spent', { kis: mine.map((o) => o.ki) }); return mine.filter((_, i) => !spent[i]); };
  const a1 = await until(async () => { const m = await scan(alice); return m.length && m; }, 30000, 'deposit minted');
  ok(a1.length === 1 && a1[0].v === 500_000n, 'deposit of 0.5 ETH minted on SILO to alice (500,000 µETH), found via ML-KEM');
  const st1 = await get('/api/stats'); ok(st1.deposits === 1 && st1.depositedWei === String(parseEther('0.5')), 'node read the Deposit event from the contract');

  // private send alice -> bob
  const build = async (w, ins, outs, fee, exit) => { const { decoys } = await get('/api/decoys?n=' + 15 * ins.length + '&avoid=' + ins.map((o) => o.g).join(','));
    return K.buildTx(ins.map((o, k) => ({ ...o, gidx: o.g, decoys: decoys.slice(k * 15, k * 15 + 15) })), outs, fee, exit); };
  const tx1 = await build(alice, a1, [{ address: bob.qaddress, v: 200_000n }, { address: alice.qaddress, v: 299_980n }], 20n);
  const r1 = await post('/api/tx', { tx: tx1 }); ok(r1.ok, 'private send accepted ' + (r1.error || ''));
  const b1 = await until(async () => { const m = await scan(bob); return m.length && m; }, 20000, 'bob receives');
  ok(b1[0].v === 200_000n, 'bob found 0.2 ETH; amount, sender and receiver never appear in the tx');
  const view = await get('/api/tx/' + r1.id); ok(view.kind === 'private' && view.vout.every((o) => o.amount === null) && view.vin[0].ring.length === 16, 'explorer shows a ring of 16 and no amounts');
  ok((await post('/api/tx', { tx: tx1 })).error, 'replaying the same tx is rejected (key image spent)');

  // bob withdraws 0.15 ETH to an EVM address on Robinhood Chain
  const payee = '0x00000000000000000000000000000000000c0ffe', before = await pub.getBalance({ address: payee });
  const tx2 = await build(bob, b1, [{ address: bob.address, v: 49_980n }], 20n, { to: payee, amount: 150_000n });
  const r2 = await post('/api/tx', { tx: tx2 }); ok(r2.ok, 'withdrawal accepted ' + (r2.error || ''));
  const forged = JSON.parse(JSON.stringify(tx2)); forged.exit.amount = '160000'; ok((await post('/api/tx', { tx: forged })).error, 'changing the exit amount breaks the signatures');
  await until(async () => (await pub.getBalance({ address: payee })) > before, 40000, 'exit paid');
  const paid = (await pub.getBalance({ address: payee })) - before; ok(paid === parseEther('0.15'), 'contract paid 0.15 ETH to the payee on Robinhood Chain');
  const nb = Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' })); ok(nb >= 1, `contract has ${nb} batch(es) posted`);
  const st2 = await until(async () => { const s = await get('/api/stats'); return s.exitsPaid === 1 && s.batches >= nb && s; }, 20000, 'node marks exit paid'); const nb2 = Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' })); ok(st2.batches === nb2 && st2.exitsPaid === 1 && st2.lastBatch.l1tx, 'node and contract agree on batches; exit marked paid');
  const ex = await get('/api/tx/' + r2.id); ok(ex.exit && ex.exit.status === 'paid' && ex.exit.l1tx, 'explorer links the withdrawal to its Robinhood Chain tx');
  // restart the node: state survives, no double mint, no double exit
  kids[1].kill('SIGTERM'); await sleep(1500); kids.push(spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: DATA, RH_RPC: RPC, ROLLUP, SEQ_KEY: SEQK, BLOCK_SEC: '1', BATCH_SEC: '5', L1_POLL_SEC: '2' }, stdio: 'ignore' }));
  await until(() => get('/api/stats').then((s) => s.height > st2.height).catch(() => false), 20000, 'restart'); await sleep(7000);
  const st3 = await get('/api/stats'); ok(st3.deposits === 1 && st3.exitsPaid === 1 && (await scan(alice)).length === 1, 'after restart: one deposit, one exit, alice still holds her change');
  ok((await pub.getBalance({ address: payee })) - before === parseEther('0.15'), 'no double payout after restart');
  // lose the node's data entirely (a wiped disk): it must rebuild its batch count from the contract and keep posting
  kids[kids.length - 1].kill('SIGTERM'); await sleep(1500); fs.rmSync(DATA, { force: true });
  const nb3 = Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' }));
  kids.push(spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_PATH: DATA, RH_RPC: RPC, ROLLUP, SEQ_KEY: SEQK, BLOCK_SEC: '1', BATCH_SEC: '3', L1_POLL_SEC: '2' }, stdio: 'ignore' }));
  const st4 = await until(async () => { const s = await get('/api/stats').catch(() => null); return s && s.batches > nb3 && s; }, 40000, 'post after data loss');
  ok(st4.l1.ok && Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' })) === st4.batches, 'after a wiped disk the node adopts the contract batches and posts batch ' + st4.batches);
  ok((await pub.getBalance({ address: payee })) - before === parseEther('0.15'), 'still no double payout after a wiped disk');
  await sleep(4000); ok((await scan(alice)).length === 0 && (await get('/api/deposits')).every((d) => d.bad), 'the old deposit is not minted a second time after a wiped disk');
} catch (e) { fail++; console.log('FAIL', e.message || e); }
console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${pass}/${pass + fail})`); done(fail ? 1 : 0);
