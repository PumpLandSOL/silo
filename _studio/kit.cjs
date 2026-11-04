// SILO brand kit: pfp, banner, og + 8 graphics, in the observatory-plate look.  node _studio/kit.cjs [name]
'use strict';
const fs = require('fs'), path = require('path'), { open, sleep } = require('./cdp.cjs');
const OUT = path.join(__dirname, '..', 'brand'), SRC = path.join(__dirname, 'kit'); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SRC, { recursive: true });
const url = (f) => 'file:///' + f.split(path.sep).join('/');

const HEAD = (W, H) => `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box}body{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:#05060a;color:#ebe5d6;font:400 22px/1.5 'IBM Plex Mono',monospace}
.serif{font-family:'Cormorant Garamond',serif}.h{font:400 92px/.92 'Cormorant Garamond',serif;letter-spacing:-.01em}.h em,em{font-style:italic;color:#ffe2a3}
.cap{font:400 15px 'IBM Plex Mono',monospace;letter-spacing:.22em;text-transform:uppercase;color:#8d8a82}.cap b{color:#f1c46a;font-weight:400}
.mu{color:#8d8a82}.g{color:#f1c46a}.frame{position:absolute;inset:26px;border:1px solid rgba(235,229,214,.3)}.frame:after{content:'';position:absolute;inset:6px;border:1px solid rgba(235,229,214,.12)}
.co{position:absolute;font:400 12px 'IBM Plex Mono';letter-spacing:.18em;color:#4a4a50}
.foot{position:absolute;left:70px;right:70px;bottom:52px;display:flex;justify-content:space-between;align-items:center}
.mark{display:flex;align-items:center;gap:14px;font:400 22px 'IBM Plex Mono';letter-spacing:.34em}.mark i{width:22px;height:22px;border-radius:50%;background:#05060a;box-shadow:0 0 0 1.5px #f1c46a,0 0 16px 3px rgba(241,196,106,.55)}
canvas{position:absolute;left:0;top:0;width:100%;height:100%}
</style></head><body>`;
const PLATE = (W, H, no) => `<div class="frame"></div><span class="co" style="left:46px;top:40px">PLATE ${no} · RA 04h 66m 3s</span><span class="co" style="right:46px;top:40px">DEC +46° 63′</span>`;
const FOOT = () => `<div class="foot"><span class="mark"><i></i>SILO</span><span class="cap">silonetwork.org · @SiloNetworkRH · <b>$SILO</b></span></div>`;
// the signature: an eclipse with a raking corona, star field, reticle
const ECL = `<script>
function eclipse(o) { const cv = document.getElementById(o.id || 'cv'), W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight, g = cv.getContext('2d'); let s = o.seed || 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H); for (let i = 0; i < W * H / 2200; i++) { g.globalAlpha = .15 + r() * .6; g.fillStyle = '#ebe5d6'; const z = r() * 1.3 + .3; g.fillRect(r() * W, r() * H, z, z); } g.globalAlpha = 1;
  const { cx, cy, R } = o, k = o.k || 1; const halo = g.createRadialGradient(cx, cy, R * .9, cx, cy, R * 3.4); halo.addColorStop(0, 'rgba(255,226,163,' + .36 * k + ')'); halo.addColorStop(.25, 'rgba(241,196,106,' + .12 * k + ')'); halo.addColorStop(1, 'rgba(241,196,106,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 4.5, 0, 7); g.fill(); g.lineCap = 'round';
  for (let i = 0; i < 170; i++) { const a = i / 170 * Math.PI * 2 + r() * .04, L = R * (1 + (.25 + r() ** 2.2 * 1.3) * k), x0 = cx + Math.cos(a) * R, y0 = cy + Math.sin(a) * R, x1 = cx + Math.cos(a) * L, y1 = cy + Math.sin(a) * L;
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(255,236,190,' + .55 * k + ')'); gr.addColorStop(1, 'rgba(241,196,106,0)'); g.strokeStyle = gr; g.lineWidth = .5 + r() * 1.8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  if (o.beads) for (let i = 0; i < 6; i++) { const a = -0.9 + i * .07; g.fillStyle = 'rgba(255,246,220,.95)'; g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * .025, 0, 7); g.fill(); }
  g.fillStyle = '#030305'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,236,190,.85)'; g.lineWidth = Math.max(1, R * .008); g.stroke();
  if (o.reticle !== false) { g.strokeStyle = 'rgba(235,229,214,.13)'; g.lineWidth = 1; g.setLineDash([2, 7]); g.beginPath(); g.arc(cx, cy, R * 2.4, 0, 7); g.stroke(); g.setLineDash([]);
    g.beginPath(); [[-2.9, 0, -2.5, 0], [2.5, 0, 2.9, 0], [0, -2.9, 0, -2.5], [0, 2.5, 0, 2.9]].forEach(([a, b, c, d]) => { g.moveTo(cx + a * R, cy + b * R); g.lineTo(cx + c * R, cy + d * R); }); g.stroke();
    for (let i = 0; i < 14; i++) { const a = i * .45 + .3; g.fillStyle = i === 0 ? '#f1c46a' : 'rgba(235,229,214,.35)'; g.beginPath(); g.arc(cx + Math.cos(a) * R * 2.4, cy + Math.sin(a) * R * 2.4, i === 0 ? R * .03 : R * .016, 0, 7); g.fill(); } } }
</script>`;
const RUN = (js) => `<script>document.fonts.ready.then(()=>{${js}})</script></body></html>`;
const head = (lab, title, top = 92) => `<div style="position:absolute;left:70px;right:70px;top:${top}px"><div class="cap">${lab}</div><div class="h" style="margin-top:20px">${title}</div></div>`;
const moon = (f, sz = 120) => `<svg width="${sz}" height="${sz}" viewBox="0 0 84 84"><circle cx="42" cy="42" r="30" fill="#f1c46a" opacity=".9"/><circle cx="${42 + 60 * (1 - f)}" cy="42" r="30" fill="#05060a" stroke="rgba(235,229,214,.5)"/><circle cx="42" cy="42" r="30" fill="none" stroke="rgba(235,229,214,.4)"/></svg>`;
const ROW = (cols, cells, big) => `<div style="display:grid;grid-template-columns:${cols};gap:34px;padding:${big ? 22 : 18}px 0;border-bottom:1px solid rgba(235,229,214,.12);align-items:center">${cells}</div>`;

const G = {
  'silo-pfp': [1000, 1000, () => HEAD(1000, 1000) + '<canvas id="cv"></canvas>' + ECL + RUN(`eclipse({cx:500,cy:500,R:250,k:1.15,beads:true,reticle:false})`)],
  'silo-banner': [1500, 500, () => HEAD(1500, 500) + `<canvas id="cv"></canvas><span class="co" style="left:30px;top:24px">PLATE No. 4663</span><span class="co" style="right:30px;top:24px">DEC +46° 63′</span>
    <div style="position:absolute;left:70px;top:150px"><div class="cap"><b>a private layer</b> · on Robinhood Chain</div><div class="h" style="font-size:96px;margin-top:16px">Your money, <em>in the dark.</em></div></div>` + ECL + RUN(`eclipse({cx:1220,cy:250,R:110,k:1})`)],
  'silo-og': [1200, 630, () => HEAD(1200, 630) + `<canvas id="cv"></canvas>${PLATE(1200, 630, 'i')}<div style="position:absolute;left:70px;top:190px;max-width:560px"><div class="cap"><b>SILO</b> · private layer 2</div><div class="h" style="font-size:86px;margin-top:18px">Your money,<br><em>in the dark.</em></div><div class="mu" style="font-size:19px;margin-top:22px">Settles every batch to Robinhood Chain.</div></div>` + FOOT() + ECL + RUN(`eclipse({cx:900,cy:300,R:120})`)],

  // 1 key art
  'silo-g01-keyart': [1600, 900, () => HEAD(1600, 900) + `<canvas id="cv"></canvas>${PLATE(1600, 900, 'i')}<div style="position:absolute;left:70px;bottom:150px;max-width:720px"><div class="cap">plate i · <b>the occultation</b></div><div class="h" style="font-size:120px;margin-top:20px">Your money,<br><em>in the dark.</em></div><div class="serif" style="font-size:30px;margin-top:22px;color:#cfc9bb">A private layer 2 that settles to Robinhood Chain.</div></div>` + FOOT() + ECL + RUN(`eclipse({cx:1080,cy:380,R:170,k:1.1})`)],

  // 2 phases
  'silo-g02-phases': [1600, 900, () => { const P = [[.15, 'Deposit', 'Send ETH to SiloRollup on Robinhood Chain. It is minted to your SILO address.'], [.6, 'Shield', 'A stealth output with a hidden amount. Only your keys can find it.'], [1, 'Send unseen', 'Ring of 16, key image, range proofs. No sender, no receiver, no amount.'], [.35, 'Return', 'Withdraw to any 0x address. The next batch pays it on Robinhood Chain.']];
    return HEAD(1600, 900) + PLATE(1600, 900, 'iii') + head('plate iii · <b>phases of a payment</b>', 'Four phases, <em>one shadow.</em>') + `<div style="position:absolute;left:70px;right:70px;top:340px;display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid rgba(235,229,214,.3)">${P.map(([f, h, p], i) => `<div style="padding:34px 30px 0 ${i ? 30 : 0}px;${i < 3 ? 'border-right:1px solid rgba(235,229,214,.12)' : ''}">${moon(f)}<div class="cap" style="margin-top:22px">phase ${['i', 'ii', 'iii', 'iv'][i]}</div><div class="serif" style="font-size:44px;margin-top:6px">${h}</div><div class="mu" style="font-size:18px;margin-top:12px">${p}</div></div>`).join('')}</div>` + FOOT() + '</body></html>'; }],

  // 3 dark vs on record
  'silo-g03-record': [1600, 900, () => { const L = [['every deposit', 'address + amount'], ['every batch', 'state root + tx root'], ['every withdrawal', '0x address + amount'], ['the contract', 'SiloRollup, open source']], D = [['who sent it', 'ring of 16'], ['who received it', 'one-time stealth key'], ['how much', 'Pedersen commitment'], ['which coin was spent', 'key image only']];
    const col = (t, rows, gold) => `<div><div class="cap" style="padding-bottom:16px;border-bottom:1px solid rgba(235,229,214,.3)">${t}</div>${rows.map(([a, b]) => ROW('1fr auto', `<span class="serif" style="font-size:36px;${gold ? '' : ''}">${a}</span><span style="font-size:16px" class="${gold ? 'g' : 'mu'}">${b}</span>`)).join('')}</div>`;
    return HEAD(1600, 900) + PLATE(1600, 900, 'iv') + head('plate iv · <b>what is public, what is dark</b>', 'Dark inside. <em>On record outside.</em>') + `<div style="position:absolute;left:70px;right:70px;top:330px;display:grid;grid-template-columns:1fr 1fr;gap:80px">${col('on Robinhood Chain · public', L)}${col('on SILO · <b>dark</b>', D, 1)}</div>` + FOOT() + '</body></html>'; }],

  // 4 vs other privacy protocols
  'silo-g04-matrix': [1600, 900, () => { const C = ['hides sender', 'hides receiver', 'hides amount', 'on Robinhood Chain', 'quantum-safe detection', 'verify in browser']; const R = [['Tornado', [.5, .5, 0, 0, 0, 0]], ['Railgun', [1, 1, 1, 0, 0, 0]], ['Aztec', [1, 1, 1, 0, 0, 0]], ['Monero', [1, 1, 1, 0, 0, 0]], ['SILO', [1, 1, 1, 1, 1, 1]]];
    const dot = (v, me) => v === 1 ? `<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${me ? '#f1c46a' : '#ebe5d6'};${me ? 'box-shadow:0 0 16px #f1c46a' : 'opacity:.8'}"></span>` : v ? '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid #ebe5d6;background:linear-gradient(90deg,#ebe5d6 50%,transparent 50%);opacity:.8"></span>' : '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;border:1px solid rgba(235,229,214,.3)"></span>';
    return HEAD(1600, 900) + PLATE(1600, 900, 'v') + head('plate v · <b>privacy, compared</b> · ◐ partial', 'Every private chain, <em>one sky.</em>', 86) + `<div style="position:absolute;left:70px;right:70px;top:280px"><div style="display:grid;grid-template-columns:230px repeat(6,1fr);padding-bottom:14px;border-bottom:1px solid rgba(235,229,214,.3)"><span></span>${C.map((c) => `<span class="cap" style="text-align:center;font-size:12px">${c}</span>`).join('')}</div>
    ${R.map(([n, v]) => { const me = n === 'SILO'; return `<div style="display:grid;grid-template-columns:230px repeat(6,1fr);padding:16px 0;border-bottom:1px solid rgba(235,229,214,.1);align-items:center;${me ? 'background:rgba(241,196,106,.07)' : ''}"><span class="serif" style="font-size:38px;padding-left:${me ? 14 : 0}px;${me ? 'color:#ffe2a3;font-style:italic' : ''}">${n}</span>${v.map((x) => `<span style="text-align:center">${dot(x, me)}</span>`).join('')}</div>`; }).join('')}</div>` + FOOT() + '</body></html>'; }],

  // 5 instruments
  'silo-g05-instruments': [1600, 900, () => { const R = [['Ring signatures', 'MLSAG over 16 outputs + key images'], ['Stealth outputs', 'a fresh one-time key per payment'], ['Hidden amounts', 'Pedersen commitments, 48-bit range proofs'], ['ML-KEM-768', 'lattice payment detection for siloq1'], ['SiloRollup', 'Solidity bridge + batches on Robinhood Chain']];
    return HEAD(1600, 900) + PLATE(1600, 900, 'vi') + head('plate vi · <b>instruments</b>', 'What the telescope <em>can’t see.</em>') + `<div style="position:absolute;left:70px;right:70px;top:330px;border-top:1px solid rgba(235,229,214,.3)">${R.map(([k, v]) => ROW('420px 1fr', `<span class="serif" style="font-size:40px;font-style:italic;color:#ffe2a3">${k}</span><span style="font-size:20px">${v}</span>`)).join('')}</div>` + FOOT() + '</body></html>'; }],

  // 6 settlement
  'silo-g06-settle': [1600, 900, () => HEAD(1600, 900) + PLATE(1600, 900, 'vii') + head('plate vii · <b>settlement</b>', 'Every batch, <em>logged in the light.</em>') + `
    <div style="position:absolute;left:70px;top:330px;width:700px"><div class="serif" style="font-size:30px;color:#cfc9bb;line-height:1.35">Every few minutes the sequencer posts a batch to <span class="g">SiloRollup</span> on Robinhood Chain: a state root, a transaction root, and the withdrawals to pay.</div>
    <div class="serif" style="font-size:30px;color:#cfc9bb;line-height:1.35;margin-top:22px">The contract pays each withdrawal once. Anyone can read every batch on the Robinhood Chain explorer.</div></div>
    <div style="position:absolute;right:70px;top:330px;width:640px;border:1px solid rgba(235,229,214,.3);padding:26px 28px;font-size:17px;line-height:1.9"><div class="cap" style="margin-bottom:12px">SiloRollup.sol</div>
      <div><span class="g">deposit</span>(bytes l2addr) <span class="mu">payable</span></div><div><span class="g">postBatch</span>(n, from, to, <span class="mu">stateRoot</span>, <span class="mu">txRoot</span>, exits[])</div><div class="mu" style="margin-top:12px">event Deposit(id, from, amount, l2addr)</div><div class="mu">event BatchPosted(n, from, to, roots, exits)</div><div class="mu">event Exited(txid, to, amount)</div></div>` + FOOT() + '</body></html>'],

  // 7 roadmap
  'silo-g07-roadmap': [1600, 900, () => { const P = [['phase i · live', 'Private L2', 'Ring-16 private transfers, stealth + ML-KEM addresses, browser wallet.', 1], ['phase ii · live', 'Settlement', 'SiloRollup on Robinhood Chain: deposits, batches, paid withdrawals.', 1], ['phase iii', 'Shielded stocks', 'Bridge Robinhood Chain stock tokens into SILO.'], ['phase iv', 'Validity proofs', 'A proof per batch, checked by the contract.'], ['phase v', 'Forced exits', 'Withdraw through the contract without the sequencer.']];
    return HEAD(1600, 900) + PLATE(1600, 900, 'viii') + head('plate viii · <b>ephemeris</b> · what comes next', 'The next <em>five transits.</em>') + `<div style="position:absolute;left:70px;right:70px;top:400px;display:grid;grid-template-columns:repeat(5,1fr);gap:30px;padding-top:44px"><div style="position:absolute;top:6px;left:0;right:0;height:1px;background:linear-gradient(90deg,#f1c46a 40%,rgba(235,229,214,.25) 40%)"></div>
    ${P.map(([l, h, p, now]) => `<div style="position:relative"><span style="position:absolute;top:-44px;left:0;width:14px;height:14px;border-radius:50%;${now ? 'background:#f1c46a;box-shadow:0 0 16px #f1c46a' : 'background:#05060a;border:1px solid rgba(235,229,214,.5)'}"></span><div class="cap" style="${now ? 'color:#f1c46a' : ''}">${l}</div><div class="serif" style="font-size:40px;line-height:1;margin:14px 0 12px">${h}</div><div class="mu" style="font-size:17px">${p}</div></div>`).join('')}</div>` + FOOT() + '</body></html>'; }],

  // 8 the eclipse metaphor
  'silo-g08-sun': [1600, 900, () => HEAD(1600, 900) + `<canvas id="cv"></canvas>${PLATE(1600, 900, 'ix')}
    <div style="position:absolute;left:70px;top:120px;max-width:620px"><div class="cap">plate ix · <b>totality</b></div><div class="h" style="margin-top:20px">Robinhood Chain is the sun. <em>SILO is the moon.</em></div>
    <div class="serif" style="font-size:30px;color:#cfc9bb;margin-top:28px;line-height:1.35">Everything around it stays in the light: the bridge, the batches, the withdrawals. What passes in front goes dark.</div></div>` + FOOT() + ECL + RUN(`eclipse({cx:1140,cy:430,R:190,k:1.2,beads:true})`)],
};

(async () => { const only = process.argv[2]; const c = await open('about:blank', 1600, 900, 9700 + Math.floor(Math.random() * 90));
  for (const [name, [w, h, fn]] of Object.entries(G)) { if (only && only !== name) continue; const f = path.join(SRC, name + '.html'); fs.writeFileSync(f, fn());
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await c.send('Page.navigate', { url: url(f) }); await sleep(2200); await c.ev('document.fonts.ready.then(()=>1)'); await sleep(600);
    await c.shot(path.join(OUT, name + '.png')); console.log('OK', name); }
  if (fs.existsSync(path.join(OUT, 'silo-og.png'))) fs.copyFileSync(path.join(OUT, 'silo-og.png'), path.join(__dirname, '..', 'client', 'og.png'));
  c.close(); process.exit(0); })();
