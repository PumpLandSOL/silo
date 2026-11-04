// shared page chrome + helpers
export const X_HANDLE = 'SiloNetworkRH';
export const $ = (id) => document.getElementById(id);
export const api = (p, b) => fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
export const eth = (units, dp = 6) => (Number(units) / 1e6).toLocaleString('en-US', { maximumFractionDigits: dp });   // L2 units are micro-ETH
export const weiEth = (wei, dp = 4) => (Number(BigInt(wei || 0) / 10n ** 12n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: dp });
export const short = (s, n = 8) => (s && s.length > n * 2 + 1 ? s.slice(0, n) + '…' + s.slice(-n) : s || '');
export const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
export function toast(m, bad) { let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); } t.textContent = m; t.className = bad ? 'bad' : ''; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = 'none'), 4200); }
export function copy(v, what) { navigator.clipboard.writeText(v).then(() => toast((what || 'value') + ' copied')); }
export function chrome(page) {
  const nav = document.createElement('nav'); nav.className = 'edge';
  nav.innerHTML = `<a class="mark" href="/"><i></i>SILO</a><span class="nl">${[['/', 'observatory'], ['/explorer', 'explorer'], ['/wallet', 'wallet'], ['/docs', 'docs']].map(([h, t]) => `<a href="${h}" class="${page === h ? 'on' : ''}">${t}</a>`).join('')}<a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener">𝕏</a></span>`;
  const plate = document.querySelector('.plate'); plate.prepend(nav);
  const f = document.createElement('footer'); f.className = 'edge';
  f.innerHTML = `<span>plate no. 4663 · SILO, a private layer on Robinhood Chain</span><span id="fx">settlement · <b>SiloRollup</b></span>`; plate.append(f);
  api('/api/stats').then((s) => { if (s.rollup) $('fx').innerHTML = `settlement · <a href="${s.explorer}/address/${s.rollup}" target="_blank" rel="noopener"><b>${short(s.rollup, 6)}</b> ↗</a>`; }).catch(() => {});
}
export const evmLink = (s, kind, v) => `${s.explorer}/${kind}/${v}`;
