// Unit test for client/rct.js: stealth scan (classic + ML-KEM), range proofs, MLSAG, full tx balance + tamper cases.
import * as K from '../client/rct.js';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const t0 = Date.now();
const alice = K.wallet(), bob = K.wallet(), eve = K.wallet();
ok(alice.address.startsWith('silo1') && alice.qaddress.startsWith('siloq1'), `addresses ${alice.address.length} / ${alice.qaddress.length} chars`);
ok(K.wallet(alice.seed).address === alice.address, 'seed restores the same wallet');
let bad = false; try { K.parseAddress(alice.address.slice(0, -1) + (alice.address.endsWith('a') ? 'b' : 'a')); } catch { bad = true; } ok(bad, 'checksum rejects a typo');

// funding outputs (clear, like coinbase) to alice, plus 40 decoys to others
const outs = []; const r0 = K.rand(), R0 = K.ph(K.G.multiply(r0));
for (let i = 0; i < 40; i++) { const m = K.makeOutput(i === 7 ? alice.address : K.wallet().address, i === 7 ? 50_000_000 : 1_000_000, i, r0, true); outs.push({ ...m.o, clear: true, R: R0, i }); }
const mine = outs.map((o) => K.scan(alice, o, o.R, o.i)).map((s, g) => s && { ...s, gidx: g }).filter(Boolean);
ok(mine.length === 1 && mine[0].v === 50_000_000n, 'alice scans exactly her output (50 ETH-units)');
ok(outs.every((o) => !K.scan(eve, o, o.R, o.i)), 'eve sees nothing');

const getOut = (g) => outs[g] && { P: outs[g].P, C: outs[g].C }; const spent = new Set();
const decoys = (avoid) => { const s = new Set([avoid]); const d = []; while (d.length < 15) { const g = Math.floor(Math.random() * outs.length); if (s.has(g)) continue; s.add(g); d.push({ gidx: g, ...getOut(g) }); } return d; };
const m = mine[0], inp = { ...m, P: outs[m.gidx].P, C: outs[m.gidx].C, decoys: decoys(m.gidx) };
const t1 = Date.now();
const tx = K.buildTx([inp], [{ address: bob.qaddress, v: 30_000_000n }, { address: alice.address, v: 19_990_000n }], 10_000n);
console.log('  build ms', Date.now() - t1, 'size KB', (JSON.stringify(tx).length / 1024).toFixed(1));
const t2 = Date.now(); const err = K.verifyTx(tx, getOut, (k) => spent.has(k)); console.log('  verify ms', Date.now() - t2);
ok(err === null, 'private tx verifies: ' + err);
ok(tx.vin[0].ring.length === 16 && tx.vin[0].ring.includes(m.gidx), 'ring of 16 hides the real input');
ok(tx.vout[0].ct && tx.vout[0].ct.length === 2176, 'quantum output carries an ML-KEM-768 ciphertext');
const bobScan = K.scan(bob, { ...tx.vout[0] }, tx.R, 0); ok(bobScan && bobScan.v === 30_000_000n, 'bob decrypts 30 ETH-units via ML-KEM');
const change = K.scan(alice, { ...tx.vout[1] }, tx.R, 1); ok(change && change.v === 19_990_000n, 'alice finds her change via ECDH');
ok(!K.scan(eve, { ...tx.vout[0] }, tx.R, 0) && !K.scan(eve, { ...tx.vout[1] }, tx.R, 1), 'eve cannot read either output');
ok(K.keyImage(m.x, outs[m.gidx].P) === tx.vin[0].ki, 'key image matches the spent output');
spent.add(tx.vin[0].ki); ok(K.verifyTx(tx, getOut, (k) => spent.has(k)) === 'key image already spent', 'double spend rejected');
spent.clear();
const t3 = JSON.parse(JSON.stringify(tx)); t3.fee = '0'; ok(K.verifyTx(t3, getOut, () => false) !== null, 'changing the fee breaks it');
const t4 = JSON.parse(JSON.stringify(tx)); t4.vout[0].C = tx.vout[1].C; ok(K.verifyTx(t4, getOut, () => false) !== null, 'swapping a commitment breaks it');
let threw = false; try { K.buildTx([inp], [{ address: bob.address, v: 60_000_000n }], 0n); } catch { threw = true; } ok(threw, 'cannot spend more than you have');
const t5 = JSON.parse(JSON.stringify(tx)); t5.vin[0].ring[3] = (t5.vin[0].ring[3] + 1) % 40; ok(K.verifyTx(t5, getOut, () => false) !== null, 'swapping a ring member breaks it');
console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${pass}/${pass + fail}) in ${Date.now() - t0} ms`); process.exit(fail ? 1 : 0);
