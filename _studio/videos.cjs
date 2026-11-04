// SILO videos (frame-exact, 1920x1080, 30fps): hype, payment.  node _studio/videos.cjs [hype|payment]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process'), { open, sleep } = require('./cdp.cjs');
const B = path.join(__dirname, '..', 'brand'), K = path.join(__dirname, 'kit'), FPS = 30, url = (f) => 'file:///' + f.split(path.sep).join('/');
fs.mkdirSync(K, { recursive: true });
const HEAD = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,400&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box}body{width:1920px;height:1080px;background:#05060a;color:#ebe5d6;overflow:hidden;position:relative;font:400 28px 'IBM Plex Mono',monospace}
#cv{position:absolute;left:0;top:0;width:1920px;height:1080px}.s{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0}
.h{font:400 150px/.92 'Cormorant Garamond',serif}.h em,em{font-style:italic;color:#ffe2a3}.cap{font-size:22px;letter-spacing:.26em;text-transform:uppercase;color:#8d8a82}.cap b{color:#f1c46a;font-weight:400}
.frame{position:absolute;inset:30px;border:1px solid rgba(235,229,214,.25)}.co{position:absolute;font-size:15px;letter-spacing:.2em;color:#4a4a50}
</style></head><body><canvas id="cv" width="1920" height="1080"></canvas><div class="frame"></div><span class="co" style="left:54px;top:48px">PLATE No. 4663 · RA 04h 66m 3s</span><span class="co" style="right:54px;top:48px">DEC +46° 63′</span><span class="co" style="left:54px;bottom:48px" id="tc"></span><span class="co" style="right:54px;bottom:48px">@SiloNetworkRH · $SILO</span>`;
// deterministic scene: stars + an eclipse whose moon slides over the sun (contact c in 0..1) with corona strength k
const JS = `const $=(i)=>document.getElementById(i),cl=(v)=>Math.max(0,Math.min(1,v)),e=(v)=>1-Math.pow(1-cl(v),3),win=(t,a,b,f=.5)=>cl(Math.min((t-a)/f,(b-t)/f));
const show=(id,t,a,b)=>{const o=win(t,a,b);$(id).style.opacity=o;$(id).style.filter='blur('+((1-o)*10).toFixed(1)+'px)'};
const g=$('cv').getContext('2d');let S=[];{let s=9;const r=()=>(s=(s*16807)%2147483647)/2147483647;for(let i=0;i<900;i++)S.push([r()*1920,r()*1080,r()*1.4+.3,.15+r()*.6,r()*6]);var RY=[];for(let i=0;i<190;i++)RY.push([i/190*Math.PI*2+r()*.04,.25+r()**2.2*1.3,.5+r()*1.8,r()*6])}
function sky(t,o){g.fillStyle='#05060a';g.fillRect(0,0,1920,1080);for(const[x,y,z,a,p]of S){g.globalAlpha=a*(.7+.3*Math.sin(t*1.4+p));g.fillStyle='#ebe5d6';g.fillRect(x,y,z,z)}g.globalAlpha=1;
 const{cx,cy,R,c,k,beads}=o,mx=cx+(1-c)*R*2.3;if(c<.98){g.fillStyle='rgba(255,232,170,'+(1-c*.9)+')';g.shadowColor='rgba(255,220,140,.9)';g.shadowBlur=R*.6;g.beginPath();g.arc(cx,cy,R,0,7);g.fill();g.shadowBlur=0}
 if(k>0){const h=g.createRadialGradient(cx,cy,R*.9,cx,cy,R*3.4);h.addColorStop(0,'rgba(255,226,163,'+.36*k+')');h.addColorStop(.25,'rgba(241,196,106,'+.12*k+')');h.addColorStop(1,'rgba(241,196,106,0)');g.fillStyle=h;g.beginPath();g.arc(cx,cy,R*4.5,0,7);g.fill();g.lineCap='round';
  for(const[a,l,w,p]of RY){const wob=Math.sin(t*.4+p)*.08,L=R*(1+(l+wob)*k),x0=cx+Math.cos(a)*R,y0=cy+Math.sin(a)*R,x1=cx+Math.cos(a)*L,y1=cy+Math.sin(a)*L;const gr=g.createLinearGradient(x0,y0,x1,y1);gr.addColorStop(0,'rgba(255,236,190,'+.55*k+')');gr.addColorStop(1,'rgba(241,196,106,0)');g.strokeStyle=gr;g.lineWidth=w;g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.stroke()}}
 if(beads>0)for(let i=0;i<6;i++){const a=-0.9+i*.07;g.fillStyle='rgba(255,246,220,'+beads+')';g.beginPath();g.arc(cx+Math.cos(a)*R,cy+Math.sin(a)*R,R*.03,0,7);g.fill()}
 g.fillStyle='#030305';g.beginPath();g.arc(mx,cy,R*1.005,0,7);g.fill();if(c>.95){g.strokeStyle='rgba(255,236,190,.85)';g.lineWidth=2;g.stroke()}}
const tc=(t)=>$('tc').textContent='T+'+t.toFixed(2)+'s · exposure';`;
const page = (body, script) => HEAD + body + `<script>${JS}\nwindow.__seek=(t)=>{${script};tc(t)};</script></body></html>`;

async function render(c, name, html, dur) { const FR = path.join(os.tmpdir(), 'silo-frames-' + name); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const f = path.join(K, name + '.html'); fs.writeFileSync(f, html);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); await c.send('Page.navigate', { url: url(f) }); await sleep(3000); await c.ev('document.fonts.ready.then(()=>1)');
  const N = Math.round(dur * FPS); for (let i = 0; i < N; i++) { await c.ev('__seek(' + (i / FPS).toFixed(4) + ')'); await c.shot(path.join(FR, 'f_' + String(i).padStart(4, '0') + '.jpg'), 'jpeg'); }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FR, 'f_%04d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', path.join(B, name + '.mp4')]);
  fs.rmSync(FR, { recursive: true, force: true }); console.log('OK', name + '.mp4'); }

// hype: the sun → the moon slides across → totality, corona → text beats → end card
const hype = () => page(`
  <div class="s" id="a" style="justify-content:flex-end;padding-bottom:150px"><div class="cap">every transaction on Robinhood Chain</div><div class="h" style="font-size:110px;margin-top:20px">happens <em>in the light.</em></div></div>
  <div class="s" id="b" style="justify-content:flex-end;padding-bottom:150px"><div class="h" style="font-size:110px">Unless something <em>passes in front.</em></div></div>
  <div class="s" id="c" style="align-items:flex-start;padding-left:150px;text-align:left"><div class="cap"><b>SILO</b> · a private layer 2</div><div class="h" style="margin-top:24px">Your money,<br><em>in the dark.</em></div></div>
  <div class="s" id="d" style="align-items:flex-start;padding-left:150px;text-align:left"><div class="cap">on the ledger</div><div class="h" style="font-size:96px;margin-top:24px;line-height:1.08">no sender.<br>no receiver.<br><em>no amount.</em></div></div>
  <div class="s" id="z"><div class="h" style="font-size:180px">SILO</div><div class="cap" style="margin-top:34px">a private layer on <b>Robinhood Chain</b> · @SiloNetworkRH · $SILO</div></div>`,
  `const c=e((t-3)/4.2),hard=t>=7.2,side=t>9&&t<13.6,cx=side?1920*.64:960,R=hard&&side?230:200;
   sky(t,{cx:t<9?960:960+e((t-9)/1.2)*(1920*.64-960)*(t<13.6?1:Math.max(0,1-(t-13.6)/.8)),cy:t<9?430:430+e((t-9)/1.2)*110*(t<13.6?1:Math.max(0,1-(t-13.6)/.8)),R:200,c,k:t>6.9?Math.min(1.2,(t-6.9)/.6):0,beads:t>6.9&&t<8.4?1-(t-6.9)/1.5:0});
   show('a',t,.4,3.4);show('b',t,3.8,6.8);show('c',t,9.4,11.6);show('d',t,11.8,13.6);{const o=cl((t-14.2)/.6);if(o>0){g.fillStyle='rgba(5,6,10,'+(o*.82)+')';g.fillRect(0,0,1920,1080)}$('z').style.opacity=o;$('z').style.filter='blur('+((1-o)*10).toFixed(1)+'px)'}`);

// payment: four phases, each a step of the moon across the sun
const payment = () => { const P = [['phase i', 'Deposit', 'ETH goes into SiloRollup on Robinhood Chain'], ['phase ii', 'Shield', 'it becomes a stealth output with a hidden amount'], ['phase iii', 'Send unseen', 'ring of 16 · key image · range proofs'], ['phase iv', 'Return', 'withdraw to any 0x address · paid in the next batch']];
  return page(P.map(([a, h, p], i) => `<div class="s" id="p${i}" style="align-items:flex-start;padding-left:150px;text-align:left"><div class="cap"><b>${a}</b></div><div class="h" style="font-size:130px;margin-top:20px">${h}</div><div style="font-size:30px;color:#cfc9bb;margin-top:26px">${p}</div></div>`).join('') +
    `<div class="s" id="z"><div class="h" style="font-size:120px">Four phases, <em>one shadow.</em></div><div class="cap" style="margin-top:34px">SILO · a private layer on <b>Robinhood Chain</b> · $SILO</div></div>`,
  `const ph=Math.min(3,Math.floor(t/3.2)),loc=t-ph*3.2,C=[.25,.6,1,.55],prev=ph?C[ph-1]:0,c=t<12.8?prev+(C[ph]-prev)*e(loc/1.2):C[3]+(1-C[3])*e((t-12.8)/1);
   sky(t,{cx:1920*.66,cy:540,R:230,c,k:c>.95?1.1:0,beads:0});for(let i=0;i<4;i++)show('p'+i,t,i*3.2+.3,i*3.2+3.1);{const o=cl((t-13.2)/.6);$('z').style.opacity=o;$('z').style.filter='blur('+((1-o)*10).toFixed(1)+'px)';if(o>0){g.fillStyle='rgba(5,6,10,'+(o*.75)+')';g.fillRect(0,0,1920,1080)}}`); };

(async () => { const only = process.argv[2]; const c = await open('about:blank', 1920, 1080, 9800 + Math.floor(Math.random() * 90));
  if (!only || only === 'hype') await render(c, 'silo-hype-16s', hype(), 16);
  if (!only || only === 'payment') await render(c, 'silo-payment-15s', payment(), 15);
  c.close(); process.exit(0); })();
