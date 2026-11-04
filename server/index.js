// SILO node: a private layer 2 that settles to Robinhood Chain.
//   Blocks every BLOCK_SEC, produced and signed by the sequencer (secp256k1, the same key that posts to Robinhood Chain).
//   Private transactions only: 16-member MLSAG ring signatures + key images, stealth one-time outputs, Pedersen-committed
//   amounts with 48-bit range proofs, ML-KEM-768 payment detection for quantum ("siloq1") addresses.
//   Bridge: ETH deposited into SiloRollup on Robinhood Chain is minted here as an output to the depositor's SILO address.
//   Exits: a private tx can carry one public exit (amount + 0x address). Every BATCH_SEC the sequencer posts the batch
//   (state root + tx root over its blocks) to SiloRollup, and the contract pays the exits in that batch.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { Worker } from 'node:worker_threads';
import * as K from '../client/rct.js';
import { createPublicClient, createWalletClient, http as vhttp, parseAbi, keccak256, toHex, encodePacked, defineChain } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), CLIENT = path.join(ROOT, 'client');
const PORT = +process.env.PORT || 8272, DATA = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const BLOCK_SEC = +process.env.BLOCK_SEC || 4, BATCH_SEC = +process.env.BATCH_SEC || 300, L1_POLL = +process.env.L1_POLL_SEC || 12;
const RH_RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com', CHAIN_ID = +process.env.CHAIN_ID || 4663;
// SiloRollup on Robinhood Chain mainnet (deployed 2026-11-04, block 106261601). Override both for local chains.
const ROLLUP = (process.env.ROLLUP || '0xa20f8a5f5e0c56bdea639aa19769ca0624e92dcb').toLowerCase(), FROM_BLOCK = BigInt(process.env.ROLLUP_FROM_BLOCK || (process.env.ROLLUP ? 0 : 106261601));
const EXPLORER = process.env.RH_EXPLORER || 'https://explorer.mainnet.chain.robinhood.com', SILO_MINT = process.env.SILO_MINT || '';
const MIN_FEE = 20n, WEI = 10n ** 12n, MAX_OUT = 100_000_000n;            // fee 20 µETH; one output holds at most 100 ETH
const now = () => Date.now(), big = (x) => BigInt(x);
const ABI = parseAbi([
  'event Deposit(uint256 indexed id, address indexed from, uint256 amount, bytes l2addr)',
  'function postBatch(uint64 n, uint64 fromBlock, uint64 toBlock, bytes32 stateRoot, bytes32 txRoot, (bytes32 txid, address to, uint256 amount)[] exits)',
  'function batches() view returns (uint64)', 'function lastBlock() view returns (uint64)', 'function sequencer() view returns (address)',
  'event BatchPosted(uint64 indexed n, uint64 fromBlock, uint64 toBlock, bytes32 stateRoot, bytes32 txRoot, uint256 exits)', 'function exited(bytes32) view returns (bool)',
  'function totalDeposited() view returns (uint256)', 'function totalExited() view returns (uint256)', 'function depositCount() view returns (uint256)']);

// ---------- state ----------
let S = { blocks: [], outs: [], kis: {}, txs: {}, deposits: {}, exits: [], batches: [], l1Cursor: null, anchor: null, seqKey: null };
try { S = { ...S, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
if (!S.anchor) S.anchor = K.wallet().seed;                                 // holds the zero-value genesis outputs that the first rings hide among
const ANCHOR = K.wallet(S.anchor);
const SEQ_KEY = process.env.SEQ_KEY || (S.seqKey ||= generatePrivateKey());   // set SEQ_KEY in production; a local key only signs local blocks
const SEQ = privateKeyToAccount(SEQ_KEY), FEEW = K.wallet(K.hex(K.unhex(keccak256(SEQ_KEY).slice(2))));   // fees go to the sequencer's own SILO wallet
let mempool = [], saveT = 0, l1 = { ok: false, err: 'not started', head: null, batches: null };
const saveNow = () => { if (saveT) { clearTimeout(saveT); saveT = 0; } try { fs.mkdirSync(path.dirname(DATA), { recursive: true }); const { seqKey, ...rest } = S; fs.writeFileSync(DATA + '.tmp', JSON.stringify(process.env.SEQ_KEY ? rest : S)); fs.renameSync(DATA + '.tmp', DATA); } catch (e) { console.error('save failed: ' + e.message); } };
const save = () => { if (!saveT) saveT = setTimeout(saveNow, 1200); };
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { saveNow(); process.exit(0); });
const worker = new Worker(new URL('./worker.js', import.meta.url)), jobs = new Map(); let jobId = 0;
worker.on('message', ({ id, ok, err }) => { const j = jobs.get(id); jobs.delete(id); err ? j[1](err) : j[0](ok); });
const work = (op, ...args) => new Promise((ok, no) => { const id = ++jobId; jobs.set(id, [ok, no]); worker.postMessage({ id, op, args }); });
const tip = () => S.blocks[S.blocks.length - 1], height = () => S.blocks.length - 1;
const getOut = (g) => S.outs[g] && { P: S.outs[g].P, C: S.outs[g].C };
const spent = (ki) => !!S.kis[ki] || mempool.some((t) => t.vin && t.vin.some((v) => v.ki === ki));
const mintable = new Map();                                              // deposit id -> queued deposit, minted in the next block

// ---------- blocks: sequencer-produced, signed, sha3-linked ----------
function addOutputs(txid, tx, h, clear) { tx.vout.forEach((o, i) => S.outs.push({ P: o.P, C: o.C, amt: o.amt, ...(o.ct ? { ct: o.ct } : {}), ...(clear ? { clear: true } : {}), R: tx.R, i, h, txid })); }
function clearTx(kind, pay, extra) { const r = K.rand(); return { v: 1, [kind]: true, ...extra, R: K.ph(K.G.multiply(r)), vout: pay.map(([a, v], i) => K.makeOutput(a, v, i, r, true).o) }; }
const kiRoot = () => keccak256(toHex(K.txhash(Object.keys(S.kis).sort())));
async function produce() {
  if (reconciling) return;
  const h = S.blocks.length, list = [], txs = mempool.splice(0, 24).filter((t) => t.vin.every((v) => !S.kis[v.ki]));
  if (h === 0) list.push(clearTx('genesis', Array.from({ length: 64 }, () => [ANCHOR.address, 0n]), {}));
  for (const [id, d] of mintable) { const parts = []; let left = big(d.units); while (left > 0n) { const p = left > MAX_OUT ? MAX_OUT : left; parts.push([d.l2, p]); left -= p; }
    list.push(clearTx('deposit', parts, { deposit: id, from: d.from, l1tx: d.l1tx, amount: d.units })); mintable.delete(id); S.deposits[id].minted = h; }
  const fees = txs.reduce((a, t) => a + big(t.fee), 0n); if (fees > 0n) list.push(clearTx('fees', [[FEEW.address, fees]], {}));
  const all = [...list, ...txs], ids = all.map((t) => K.txhash(t)), ts = now();
  const hdr = { h, prev: h ? tip().hash : '0x' + '0'.repeat(64), ts, txRoot: keccak256(toHex(K.txhash(ids))), outs: S.outs.length };
  const hash = keccak256(toHex(JSON.stringify(hdr))), sig = await SEQ.signMessage({ message: { raw: hash } });
  all.forEach((t, k) => { const id = ids[k]; S.txs[id] = { ...t, h, ts }; if (t.vin) t.vin.forEach((v) => (S.kis[v.ki] = id)); addOutputs(id, t, h, !t.vin);
    if (t.exit) S.exits.push({ txid: '0x' + id, to: t.exit.to, amount: String(big(t.exit.amount) * WEI), h, status: 'pending' }); });
  S.blocks.push({ ...hdr, hash, sig, txs: ids, size: JSON.stringify(all).length, fees: String(fees) }); prune();
  if (all.some((t) => t.deposit || t.exit)) saveNow(); else save();
}
function prune() { const cut = height() - 3000; if (cut <= 0) return; for (const id of S.blocks[cut].txs || []) { const t = S.txs[id]; if (t && t.vin && !t.pruned) { t.vin.forEach((v) => delete v.sig); t.vout.forEach((o) => delete o.rp); t.pruned = true; } } }
async function submit(tx) { if (mempool.length > 300) throw 'mempool full'; if (!tx || !Array.isArray(tx.vin) || !Array.isArray(tx.vout)) throw 'malformed';
  if (tx.genesis || tx.deposit || tx.fees) throw 'malformed';
  const ring = {}; for (const v of tx.vin) for (const g of Array.isArray(v.ring) ? v.ring.slice(0, 16) : []) { const o = getOut(g); if (o) ring[g] = o; }
  const kis = tx.vin.map((v) => v && v.ki).filter((k) => typeof k === 'string');
  const err = await work('verify', tx, ring, kis.filter(spent)); if (err) throw err; if (kis.some(spent)) throw 'key image already spent';
  if (big(tx.fee) < MIN_FEE) throw 'fee below 0.00002 ETH'; if (tx.exit && big(tx.exit.amount) < 1000n) throw 'smallest withdrawal is 0.001 ETH';
  mempool.push(tx); return K.txhash(tx); }
function decoys(avoid, n = 15) { const pool = S.outs.map((o, g) => g); const s = new Set(avoid), d = []; let tries = 0;
  while (d.length < n && tries++ < 6000) { const g = pool[Math.floor(Math.random() * pool.length)]; if (s.has(g)) continue; s.add(g); d.push({ gidx: g, ...getOut(g) }); }
  if (d.length < n) throw 'not enough outputs for a ring yet'; return d; }

// ---------- Robinhood Chain: deposits in, batches out ----------
const rh = defineChain({ id: CHAIN_ID, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RH_RPC] } } });
const pub = createPublicClient({ chain: rh, transport: vhttp(RH_RPC) }), wal = createWalletClient({ chain: rh, account: SEQ, transport: vhttp(RH_RPC) });
async function pollDeposits() {
  const head = await pub.getBlockNumber(); l1.head = Number(head);
  let from = S.l1Cursor != null ? BigInt(S.l1Cursor) + 1n : FROM_BLOCK;
  while (from <= head) { const to = from + 4999n > head ? head : from + 4999n;
    const logs = await pub.getLogs({ address: ROLLUP, event: ABI[0], fromBlock: from, toBlock: to });
    for (const lg of logs) { const id = String(lg.args.id); if (S.deposits[id]) continue; const wei = lg.args.amount;
      if (S.adoptedAt && Number(lg.blockNumber) <= S.adoptedAt) { S.deposits[id] = { id, from: lg.args.from.toLowerCase(), wei: String(wei), l1tx: lg.transactionHash, l1block: Number(lg.blockNumber), bad: 'settled before a node reset: not re-minted', ts: now() }; continue; }
      let l2 = ''; try { l2 = Buffer.from(lg.args.l2addr.slice(2), 'hex').toString('utf8'); K.parseAddress(l2); } catch { S.deposits[id] = { id, from: lg.args.from, wei: String(wei), l1tx: lg.transactionHash, bad: 'not a SILO address', ts: now() }; continue; }
      S.deposits[id] = { id, from: lg.args.from.toLowerCase(), wei: String(wei), units: String(wei / WEI), l2, l1tx: lg.transactionHash, l1block: Number(lg.blockNumber), ts: now() };
      mintable.set(id, S.deposits[id]); console.log(`deposit #${id} ${Number(wei) / 1e18} ETH`); }
    S.l1Cursor = String(to); from = to + 1n; saveNow(); }
}
async function fillerBlock() { const h = S.blocks.length, ts = now(), hdr = { h, prev: h ? tip().hash : '0x' + '0'.repeat(64), ts, txRoot: keccak256(toHex(K.txhash([]))), outs: S.outs.length, filler: true };
  const hash = keccak256(toHex(JSON.stringify(hdr))), sig = await SEQ.signMessage({ message: { raw: hash } }); S.blocks.push({ ...hdr, hash, sig, txs: [], size: 0, fees: '0' }); }
async function reconcile() {
  const onchain = Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' })); if (onchain <= S.batches.length) return; reconciling = true; try {
  const ev = ABI.find((x) => x.type === 'event' && x.name === 'BatchPosted'), head = await pub.getBlockNumber(); let from = FROM_BLOCK; const found = [];
  while (from <= head && found.length < onchain) { const to = from + 4999n > head ? head : from + 4999n; for (const lg of await pub.getLogs({ address: ROLLUP, event: ev, fromBlock: from, toBlock: to })) found.push(lg); from = to + 1n; }
  for (const lg of found.sort((a, b) => Number(a.args.n) - Number(b.args.n))) { const n = Number(lg.args.n); if (n <= S.batches.length) continue;
    S.batches.push({ n, fromBlock: Number(lg.args.fromBlock), toBlock: Number(lg.args.toBlock), stateRoot: lg.args.stateRoot, txRoot: lg.args.txRoot, exits: Number(lg.args.exits), l1tx: lg.transactionHash, l1block: Number(lg.blockNumber), ts: now(), adopted: true }); }
  const last = S.batches[S.batches.length - 1]; if (!last) return;
  S.adoptedAt = Math.max(S.adoptedAt || 0, last.l1block);   // deposits at or before this Robinhood Chain block were minted by the lost state
  mempool.length = 0;   // keep the adopted range empty so nothing lands in blocks the contract already settled
  while (height() < last.toBlock) await fillerBlock();
  for (const e of S.exits.filter((x) => x.status === 'pending')) if (await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'exited', args: [e.txid] })) e.status = 'paid';
  saveNow(); console.log(`reconciled with contract: batch ${last.n}, blocks to ${last.toBlock}`); } finally { reconciling = false; }
}
let posting = false, reconciling = false;
async function postBatch(force) {
  if (posting) return; const last = S.batches[S.batches.length - 1], fromBlock = last ? last.toBlock + 1 : 0, toBlock = height();
  if (toBlock < fromBlock) return; const pend = S.exits.filter((e) => e.status === 'pending' && e.h <= toBlock).slice(0, 40);
  if (!force && !pend.length && last && now() - last.ts < BATCH_SEC * 1000) return;
  posting = true;
  try { const onchain = Number(await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'batches' })), n = onchain + 1;
    if (n !== S.batches.length + 1) throw new Error(`contract is at batch ${onchain}, node at ${S.batches.length}`);
    const stateRoot = keccak256(encodePacked(['bytes32', 'bytes32', 'uint64'], [keccak256(toHex(K.txhash(S.outs.map((o) => o.P + o.C)))), kiRoot(), BigInt(toBlock)]));
    const txRoot = keccak256(toHex(S.blocks.slice(fromBlock, toBlock + 1).map((b) => b.hash.slice(2)).join('')));
    const exits = []; for (const e of pend) { if (await pub.readContract({ address: ROLLUP, abi: ABI, functionName: 'exited', args: [e.txid] })) { e.status = 'paid'; continue; } exits.push({ txid: e.txid, to: e.to, amount: big(e.amount) }); }
    const hash = await wal.writeContract({ address: ROLLUP, abi: ABI, functionName: 'postBatch', args: [BigInt(n), BigInt(fromBlock), BigInt(toBlock), stateRoot, txRoot, exits] });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); if (rc.status !== 'success') throw new Error('postBatch reverted ' + hash);
    pend.forEach((e) => { e.status = 'paid'; e.l1tx = hash; e.batch = n; });
    S.batches.push({ n, fromBlock, toBlock, stateRoot, txRoot, exits: exits.length, l1tx: hash, l1block: Number(rc.blockNumber), ts: now() }); saveNow();
    console.log(`batch ${n} blocks ${fromBlock}-${toBlock} exits ${exits.length} ${hash}`);
  } finally { posting = false; }
}
async function l1Loop() { for (;;) { if (ROLLUP) { try { await reconcile(); await pollDeposits(); await postBatch(false); l1 = { ...l1, ok: true, err: null }; } catch (e) { l1 = { ...l1, ok: false, err: String(e.shortMessage || e.message || e).slice(0, 200) }; console.error('L1:', l1.err); } }
  else l1 = { ok: false, err: 'ROLLUP not set' }; await new Promise((r) => setTimeout(r, L1_POLL * 1000)); } }

// ---------- views ----------
const kind = (t) => t.genesis ? 'genesis' : t.deposit ? 'deposit' : t.fees ? 'fees' : t.exit ? 'withdraw' : 'private';
const txSummary = (id) => { const t = S.txs[id]; if (!t) return null; return { id, h: t.h, ts: t.ts, kind: kind(t), ins: t.vin ? t.vin.length : 0, outs: t.vout.length, fee: t.fee || '0', quantum: t.vout.filter((o) => o.ct).length, amount: t.deposit ? t.amount : t.exit ? t.exit.amount : null }; };
const blockView = (b) => ({ height: b.h, hash: b.hash, prev: b.prev, ts: b.ts, txRoot: b.txRoot, sig: b.sig, size: b.size, fees: b.fees, txs: b.txs.length, batch: (S.batches.find((x) => b.h >= x.fromBlock && b.h <= x.toBlock) || {}).n || null });
function stats() { const priv = Object.values(S.txs).filter((t) => t.vin), dep = Object.values(S.deposits).filter((d) => !d.bad), last = S.batches[S.batches.length - 1];
  const tvl = dep.reduce((a, d) => a + big(d.wei), 0n) - S.exits.filter((e) => e.status === 'paid').reduce((a, e) => a + big(e.amount), 0n);
  return { name: 'SILO', ticker: 'SILO', network: 'mainnet', settlement: 'Robinhood Chain', chainId: CHAIN_ID, rollup: ROLLUP || null, sequencer: SEQ.address, explorer: EXPLORER, mint: SILO_MINT || null,
    height: height(), blockTime: BLOCK_SEC, batchEvery: BATCH_SEC, outputs: S.outs.length, privateTxs: priv.length, keyImages: Object.keys(S.kis).length, quantumOutputs: priv.reduce((a, t) => a + t.vout.filter((o) => o.ct).length, 0), mempool: mempool.length,
    deposits: dep.length, depositedWei: String(dep.reduce((a, d) => a + big(d.wei), 0n)), exitsPaid: S.exits.filter((e) => e.status === 'paid').length, exitsPending: S.exits.filter((e) => e.status === 'pending').length, tvlWei: String(tvl),
    batches: S.batches.length, lastBatch: last || null, nextBatchIn: last ? Math.max(0, Math.round((last.ts + BATCH_SEC * 1000 - now()) / 1000)) : 0, l1, ring: K.RING, bits: K.BITS, minFee: String(MIN_FEE) }; }
function search(q) { q = String(q || '').trim().toLowerCase(); if (/^\d+$/.test(q) && S.blocks[+q]) return { type: 'block', id: q };
  const h = q.replace(/^0x/, ''); if (/^[0-9a-f]{64}$/.test(h)) { if (S.txs[h]) return { type: 'tx', id: h }; const b = S.blocks.find((x) => x.hash === '0x' + h); if (b) return { type: 'block', id: String(b.h) }; if (S.kis[h]) return { type: 'tx', id: S.kis[h] };
    const d = Object.values(S.deposits).find((x) => x.l1tx === '0x' + h); if (d && d.minted != null) return { type: 'block', id: String(d.minted) }; }
  return null; }

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const PAGES = { '/': 'index.html', '/explorer': 'explorer.html', '/wallet': 'wallet.html', '/docs': 'docs.html' };
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 3e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (p === '/api/stats') return json(res, 200, stats());
    if (p === '/api/blocks') { const lim = Math.min(100, +u.searchParams.get('limit') || 15), before = u.searchParams.has('before') ? +u.searchParams.get('before') : S.blocks.length; return json(res, 200, S.blocks.slice(Math.max(0, before - lim), before).reverse().map(blockView)); }
    if (p.startsWith('/api/block/')) { const id = decodeURIComponent(p.slice(11)), b = /^\d+$/.test(id) ? S.blocks[+id] : S.blocks.find((x) => x.hash === id); if (!b) return json(res, 404, { error: 'no such block' }); return json(res, 200, { ...blockView(b), tx: b.txs.map(txSummary).filter(Boolean) }); }
    if (p === '/api/txs') { const ids = []; for (let i = S.blocks.length - 1; i >= 0 && ids.length < 20; i--) for (const id of [...S.blocks[i].txs].reverse()) if (!S.txs[id]?.genesis && ids.length < 20) ids.push(id); return json(res, 200, { mempool: mempool.map((t) => ({ id: K.txhash(t), kind: kind(t), ins: t.vin.length, outs: t.vout.length })), recent: ids.map(txSummary) }); }
    if (p === '/api/batches') return json(res, 200, [...S.batches].reverse().slice(0, 50));
    if (p === '/api/deposits') return json(res, 200, Object.values(S.deposits).reverse().slice(0, 50).map(({ l2, ...d }) => ({ ...d, l2: l2 ? l2.slice(0, 14) + '…' : null })));
    if (p === '/api/exits') return json(res, 200, [...S.exits].reverse().slice(0, 50));
    if (p.startsWith('/api/rawtx/')) { const id = p.slice(11), t = S.txs[id] || mempool.find((x) => K.txhash(x) === id); if (!t) return json(res, 404, { error: 'no such transaction' }); if (!t.vin) return json(res, 200, { clear: true, kind: kind(t) });
      if (t.pruned) return json(res, 200, { pruned: true }); const ring = {}; for (const v of t.vin) for (const g of v.ring) ring[g] = getOut(g); const { h, ts, ...tx } = t; return json(res, 200, { tx, ring }); }
    if (p.startsWith('/api/tx/')) { const id = p.slice(8), t = S.txs[id] || mempool.find((x) => K.txhash(x) === id); if (!t) return json(res, 404, { error: 'no such transaction' });
      const ex = t.exit ? S.exits.find((e) => e.txid === '0x' + id) : null;
      return json(res, 200, { id, h: t.h ?? null, ts: t.ts ?? null, kind: kind(t), confirmations: t.h != null ? height() - t.h + 1 : 0, fee: t.fee || '0', R: t.R,
        vin: t.vin ? t.vin.map((v) => ({ ki: v.ki, pseudo: v.pseudo, ring: v.ring })) : [], deposit: t.deposit ? { id: t.deposit, from: t.from, l1tx: t.l1tx, amount: t.amount } : null,
        exit: t.exit ? { ...t.exit, status: ex ? ex.status : 'pending', l1tx: ex && ex.l1tx, batch: ex && ex.batch } : null,
        vout: t.vout.map((o) => ({ P: o.P, C: o.C, quantum: !!o.ct, ctBytes: o.ct ? o.ct.length / 2 : 0, amount: t.vin ? null : o.amt, rangeBits: o.rp ? o.rp.length : t.vin ? K.BITS : 0 })), size: JSON.stringify(t).length }); }
    if (p === '/api/search') { const r = search(u.searchParams.get('q')); return json(res, r ? 200 : 404, r || { error: 'nothing found: try a block height, block hash, tx id, key image or a Robinhood Chain deposit tx' }); }
    if (p === '/api/outputs') { const from = Math.max(0, +u.searchParams.get('from') || 0), lim = Math.min(4000, +u.searchParams.get('limit') || 2000); return json(res, 200, { height: height(), total: S.outs.length, outs: S.outs.slice(from, from + lim).map((o, k) => ({ g: from + k, ...o })) }); }
    if (p === '/api/spent' && req.method === 'POST') { const d = await body(req); return json(res, 200, { spent: (d.kis || []).slice(0, 5000).map((k) => (S.kis[k] ? 'chain' : mempool.some((t) => t.vin.some((v) => v.ki === k)) ? 'pool' : null)) }); }
    if (p === '/api/decoys') { const avoid = (u.searchParams.get('avoid') || '').split(',').filter(Boolean).map(Number), n = Math.min(15 * 8, +u.searchParams.get('n') || 15); return json(res, 200, { decoys: decoys(avoid, n), height: height() }); }
    if (p === '/api/tx' && req.method === 'POST') { const d = await body(req); try { return json(res, 200, { ok: true, id: await submit(d.tx) }); } catch (e) { return json(res, 200, { error: String(e) }); } }
    if (p.startsWith('/vendor/')) { const f = path.join(ROOT, 'node_modules', '@noble', path.normalize(p.slice(8)).replace(/^(\.\.[\\/])+/, '')); if (!f.startsWith(path.join(ROOT, 'node_modules')) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=86400' }); return fs.createReadStream(f).pipe(res); }
    const file = PAGES[p.replace(/\/$/, '') || '/'] || path.normalize(p).replace(/^(\.\.[\\/])+/, '').slice(1), full = path.join(CLIENT, file);
    if (!full.startsWith(CLIENT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(full).pipe(res);
  } catch (e) { json(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log(`SILO on :${PORT} · height ${height()} · sequencer ${SEQ.address} · rollup ${ROLLUP || '(unset)'}`));

(async function blocks() { for (;;) { try { await produce(); } catch (e) { console.error('block:', e); } await new Promise((r) => setTimeout(r, BLOCK_SEC * 1000)); } })();
l1Loop();
