// SILO cryptography, shared by the rollup node and the browser wallet.
// ristretto255 group, Pedersen commitments, per-bit range proofs, 16-member MLSAG ring signatures
// with key images, stealth one-time outputs (classic ECDH or ML-KEM-768 "Faraday" payment detection).
import { RistrettoPoint } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha3_256 } from '@noble/hashes/sha3';
import { randomBytes, bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';

export const N = 2n ** 252n + 27742317777372353535851937790883648493n;
export const RING = 16, BITS = 48, DECIMALS = 6, UNIT = 10n ** 6n;
export const G = RistrettoPoint.BASE, Z = RistrettoPoint.ZERO;
export { bytesToHex as hex, hexToBytes as unhex };

const mod = (a) => ((a % N) + N) % N;
const le = (b) => { let x = 0n; for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]); return x; };
const sbytes = (s) => { const o = new Uint8Array(32); let x = mod(s); for (let i = 0; i < 32; i++) { o[i] = Number(x & 255n); x >>= 8n; } return o; };
const enc = (p) => p.toRawBytes();
const part = (x) => typeof x === 'string' ? utf8ToBytes(x) : typeof x === 'bigint' ? sbytes(x) : x instanceof Uint8Array ? x : enc(x);
export const Hs = (...xs) => mod(le(sha512(concatBytes(...xs.map(part)))));
export const Hp = (x) => RistrettoPoint.hashToCurve(sha512(concatBytes(utf8ToBytes('silo/Hp'), part(x))));
export const H = Hp('silo/H/value-generator');
export const rand = () => mod(le(randomBytes(64))) || 1n;
const mul = (P, s) => { s = mod(s); return s === 0n ? Z : P.multiply(s); };
export const pt = (h) => RistrettoPoint.fromHex(h), sc = (h) => le(hexToBytes(h)), ph = (p) => bytesToHex(enc(p)), sh = (s) => bytesToHex(sbytes(s));
export const txhash = (o) => bytesToHex(sha3_256(utf8ToBytes(typeof o === 'string' ? o : JSON.stringify(o))));
export const commit = (x, v) => mul(G, x).add(mul(H, BigInt(v)));

// ---------- base58 addresses ----------
const A58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(b) { let x = 0n; for (const c of b) x = x * 256n + BigInt(c); let s = ''; while (x > 0n) { s = A58[Number(x % 58n)] + s; x /= 58n; } for (const c of b) { if (c) break; s = '1' + s; } return s; }
export function unb58(s) { let x = 0n; for (const c of s) { const i = A58.indexOf(c); if (i < 0) throw 'bad address'; x = x * 58n + BigInt(i); } const o = []; while (x > 0n) { o.unshift(Number(x & 255n)); x >>= 8n; } for (const c of s) { if (c !== '1') break; o.unshift(0); } return Uint8Array.from(o); }
const ck = (b) => sha3_256(concatBytes(utf8ToBytes('silo/addr'), b)).slice(0, 4);

// ---------- wallets ----------
export function wallet(seedHex) {
  const seed = seedHex ? hexToBytes(seedHex) : randomBytes(32);
  const a = Hs('spend', seed), b = Hs('view', seed), kem = ml_kem768.keygen(sha512(concatBytes(utf8ToBytes('kem'), seed)));
  const A = mul(G, a), B = mul(G, b), body = concatBytes(enc(A), enc(B));
  return { seed: bytesToHex(seed), a, b, A, B, kemPk: kem.publicKey, kemSk: kem.secretKey,
    address: 'silo1' + b58(concatBytes(body, ck(body))), qaddress: 'siloq1' + b58(concatBytes(body, kem.publicKey, ck(concatBytes(body, kem.publicKey)))) };
}
export function parseAddress(s) {
  s = String(s || '').trim(); const q = s.startsWith('siloq1'); if (!q && !s.startsWith('silo1')) throw 'address must start with kyb1 or kybq1';
  const raw = unb58(s.slice(q ? 6 : 5)), body = raw.slice(0, -4), c = raw.slice(-4), want = ck(body);
  if (body.length !== (q ? 64 + 1184 : 64) || c.some((x, i) => x !== want[i])) throw 'bad address checksum';
  return { A: RistrettoPoint.fromHex(body.slice(0, 32)), B: RistrettoPoint.fromHex(body.slice(32, 64)), kemPk: q ? body.slice(64) : null, quantum: q };
}

// ---------- stealth outputs ----------
const amtPad = (ss, i) => le(sha512(concatBytes(utf8ToBytes('silo/amt'), ss, sbytes(BigInt(i)))).slice(0, 8));
function derive(ss, i, A) { const k = Hs('out', ss, BigInt(i)); return { k, P: mul(G, k).add(A), x: Hs('mask', ss, BigInt(i)) }; }
// make one output. r = tx secret (classic path shares R = rG per tx). clear = coinbase (mask 1, amount public).
export function makeOutput(addr, v, i, r, clear) {
  const to = typeof addr === 'string' ? parseAddress(addr) : addr; let ss, ct = null;
  if (to.kemPk) { const e = ml_kem768.encapsulate(to.kemPk); ss = e.sharedSecret; ct = bytesToHex(e.cipherText); } else ss = enc(mul(to.B, r));
  const { k, P, x } = derive(ss, i, to.A), mask = clear ? 1n : x, C = commit(mask, v);
  const o = { P: ph(P), C: ph(C), amt: clear ? String(v) : (BigInt(v) ^ amtPad(ss, i)).toString(16) }; if (ct) o.ct = ct;
  return { o, mask, v: BigInt(v) };
}
// scan one output: returns { v, mask, x(one-time secret) } if it is ours, else null.
export function scan(w, out, R, i) {
  let ss; if (out.ct) { try { ss = ml_kem768.decapsulate(hexToBytes(out.ct), w.kemSk); } catch { return null; } } else { if (!R) return null; ss = enc(mul(pt(R), w.b)); }
  const { k, P, x } = derive(ss, i, w.A); if (ph(P) !== out.P) return null;
  const clear = out.clear, v = clear ? BigInt(out.amt) : BigInt('0x' + out.amt) ^ amtPad(ss, i), mask = clear ? 1n : x;
  if (ph(commit(mask, v)) !== out.C) return null;
  return { v, mask, x: mod(k + w.a) };
}
export const keyImage = (x, P) => ph(mul(Hp(typeof P === 'string' ? hexToBytes(P) : enc(P)), x));

// ---------- range proof: v in [0, 2^48) via per-bit 2-member ring signatures ----------
export function rangeProve(v, x, msg) {
  const bits = [], xs = []; let acc = 0n;
  for (let j = 0; j < BITS; j++) { const xj = j === BITS - 1 ? mod(x - acc) : rand(); acc = mod(acc + xj); xs.push(xj); }
  for (let j = 0; j < BITS; j++) { const b = Number((BigInt(v) >> BigInt(j)) & 1n), Cj = commit(xs[j], b ? 1n << BigInt(j) : 0n);
    bits.push({ b, Cj, keys: [Cj, Cj.subtract(mul(H, 1n << BigInt(j)))], xj: xs[j] }); }
  // AOS 2-ring: the bit commitment opens to 0 (key Cj) or to 2^j (key Cj - 2^j H), and nobody can tell which
  return bits.map(({ b, Cj, keys, xj }) => {
    const al = rand(), s = [rand(), rand()], e = [0n, 0n]; const nx = (b + 1) % 2;
    e[nx] = Hs(msg, Cj, mul(G, al));                      // challenge for the other member
    if (b === 0) { /* real 0: e1 set; close ring via member 1 back to 0 */ const L1 = mul(G, s[1]).add(mul(keys[1], e[1])); e[0] = Hs(msg, Cj, L1); s[0] = mod(al - e[0] * xj); }
    else { const L0 = mul(G, s[0]).add(mul(keys[0], e[0])); e[1] = Hs(msg, Cj, L0); s[1] = mod(al - e[1] * xj); }
    return { C: ph(Cj), e0: sh(e[0]), s0: sh(s[0]), s1: sh(s[1]) };
  });
}
export function rangeVerify(Chex, proof, msg) {
  if (!Array.isArray(proof) || proof.length !== BITS) return false; let sum = Z;
  for (let j = 0; j < BITS; j++) { const p = proof[j], Cj = pt(p.C), K1 = Cj.subtract(mul(H, 1n << BigInt(j))), e0 = sc(p.e0);
    const e1 = Hs(msg, Cj, mul(G, sc(p.s0)).add(mul(Cj, e0))); const e0b = Hs(msg, Cj, mul(G, sc(p.s1)).add(mul(K1, e1)));
    if (e0b !== e0) return false; sum = sum.add(Cj); }
  return sum.equals(pt(Chex));
}

// ---------- MLSAG over ring of 16: row0 one-time keys (linkable via key image), row1 commitment-to-zero ----------
export function mlsagSign(msg, ring, s, x, z, Cpseudo) {
  const n = ring.length, Pk = ring.map((m) => pt(m.P)), Zk = ring.map((m) => pt(m.C).subtract(Cpseudo)), HP = ring.map((m) => Hp(hexToBytes(m.P)));
  const I = mul(HP[s], x), a0 = rand(), a1 = rand(), c = new Array(n), r = ring.map(() => [rand(), rand()]);
  c[(s + 1) % n] = Hs(msg, mul(G, a0), mul(HP[s], a0), mul(G, a1));
  for (let k = 1; k < n; k++) { const j = (s + k) % n, nj = (j + 1) % n;
    c[nj] = Hs(msg, mul(G, r[j][0]).add(mul(Pk[j], c[j])), mul(HP[j], r[j][0]).add(mul(I, c[j])), mul(G, r[j][1]).add(mul(Zk[j], c[j]))); }
  r[s] = [mod(a0 - c[s] * x), mod(a1 - c[s] * z)];
  return { c0: sh(c[0]), r: r.map(([u, v]) => [sh(u), sh(v)]), I: ph(I) };
}
export function mlsagVerify(msg, ring, sig, Cpseudo) {
  if (!sig || ring.length !== RING || sig.r.length !== RING) return false;
  const I = pt(sig.I); if (I.equals(Z)) return false; let c = sc(sig.c0); const c0 = c;
  for (let j = 0; j < RING; j++) { const P = pt(ring[j].P), Zj = pt(ring[j].C).subtract(Cpseudo), HP = Hp(hexToBytes(ring[j].P)), r0 = sc(sig.r[j][0]), r1 = sc(sig.r[j][1]);
    c = Hs(msg, mul(G, r0).add(mul(P, c)), mul(HP, r0).add(mul(I, c)), mul(G, r1).add(mul(Zj, c))); }
  return c === c0;
}

// ---------- full private transaction ----------
// ins: [{ v, mask, x, gidx, P, C, decoys:[{gidx,P,C} x15] }], outs: [{ address, v }], fee: bigint
export function buildTx(ins, outs, fee, exit) {
  const r = rand(), R = ph(mul(G, r)), made = outs.map((o, i) => makeOutput(o.address, o.v, i, r));
  const xv = exit ? BigInt(exit.amount) : 0n, tin = BigInt(ins.reduce((a, i) => a + BigInt(i.v), 0n)), tout = made.reduce((a, m) => a + m.v, 0n) + BigInt(fee) + xv;
  if (tin !== tout) throw 'inputs do not balance outputs + fee';
  const outMask = made.reduce((a, m) => mod(a + m.mask), 0n), pm = ins.map((_, k) => k < ins.length - 1 ? rand() : 0n);
  pm[ins.length - 1] = mod(outMask - pm.slice(0, -1).reduce((a, b) => mod(a + b), 0n));
  const prepared = ins.map((inp, k) => { const ring = [...inp.decoys], s = Math.floor(Math.random() * RING); ring.splice(s, 0, { gidx: inp.gidx, P: inp.P, C: inp.C });
    return { ring, s, x: inp.x, z: mod(inp.mask - pm[k]), pseudo: commit(pm[k], inp.v) }; });
  const prefix = { v: 1, R, fee: String(fee), ...(exit ? { exit: { to: String(exit.to).toLowerCase(), amount: String(xv) } } : {}), vin: prepared.map((p) => ({ ring: p.ring.map((m) => m.gidx), pseudo: ph(p.pseudo) })), vout: made.map((m) => m.o) };
  const msg = txhash(prefix);
  prefix.vin.forEach((v, k) => { const p = prepared[k]; v.sig = mlsagSign(msg, p.ring, p.s, p.x, p.z, p.pseudo); v.ki = v.sig.I; });
  prefix.vout.forEach((o, i) => { o.rp = rangeProve(made[i].v, made[i].mask, msg); });
  return prefix;
}
// verify against chain lookups: getOut(gidx) -> {P,C}, spent(ki) -> bool
export function verifyTx(tx, getOut, spent) {
  if (!tx || tx.v !== 1 || !Array.isArray(tx.vin) || !Array.isArray(tx.vout) || !tx.vin.length || !tx.vout.length || tx.vin.length > 8 || tx.vout.length > 8) return 'malformed';
  const fee = BigInt(tx.fee); if (fee < 0n) return 'bad fee';
  let xv = 0n; if (tx.exit !== undefined) { if (!tx.exit || !/^0x[0-9a-f]{40}$/.test(tx.exit.to) || !/^[0-9]+$/.test(String(tx.exit.amount))) return 'bad exit'; xv = BigInt(tx.exit.amount); if (xv <= 0n) return 'bad exit'; }
  const prefix = { v: 1, R: tx.R, fee: tx.fee, ...(tx.exit ? { exit: tx.exit } : {}), vin: tx.vin.map((v) => ({ ring: v.ring, pseudo: v.pseudo })), vout: tx.vout.map(({ rp, ...o }) => o) }, msg = txhash(prefix);
  const seen = new Set(); let sumIn = Z, sumOut = Z;
  for (const v of tx.vin) {
    if (!Array.isArray(v.ring) || v.ring.length !== RING || new Set(v.ring).size !== RING) return 'ring must be 16 distinct outputs';
    const ring = v.ring.map((g) => getOut(g)); if (ring.some((m) => !m)) return 'ring member not found';
    if (v.ki !== v.sig.I || seen.has(v.ki) || spent(v.ki)) return 'key image already spent'; seen.add(v.ki);
    const Cp = pt(v.pseudo); if (!mlsagVerify(msg, ring, v.sig, Cp)) return 'ring signature invalid'; sumIn = sumIn.add(Cp);
  }
  for (const o of tx.vout) { if (!rangeVerify(o.C, o.rp, msg)) return 'range proof invalid'; sumOut = sumOut.add(pt(o.C)); }
  if (!sumIn.equals(sumOut.add(mul(H, fee + xv)))) return 'amounts do not balance';
  return null;
}
