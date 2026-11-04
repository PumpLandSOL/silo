// local dev: a local Robinhood Chain (anvil, chain 4663) + SiloRollup + the SILO node on :8272.
// Uses anvil's public dev keys. Account #2 (0x3C44…93BC) is funded for test deposits from a browser wallet.
import { spawn, execFileSync } from 'node:child_process'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const FB = path.join(os.homedir(), '.foundry', 'bin'), bin = (n) => path.join(FB, n + (process.platform === 'win32' ? '.exe' : ''));
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), RPC = 'http://127.0.0.1:8546';
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', SEQK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const anvil = spawn(bin('anvil'), ['--port', '8546', '--chain-id', '4663', '--block-time', '1', '--silent'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }); if (r.ok) break; } catch {} await sleep(300); }
const out = execFileSync(bin('forge'), ['create', 'src/SiloRollup.sol:SiloRollup', '--rpc-url', RPC, '--private-key', DEPLOYER, '--broadcast', '--constructor-args', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'], { cwd: path.join(ROOT, 'contracts') }).toString();
const ROLLUP = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1]; console.log('SiloRollup (local) at', ROLLUP);
const node = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '8272', DATA_PATH: path.join(os.tmpdir(), 'silo-dev-' + Date.now() + '.json'), RH_RPC: RPC, RH_EXPLORER: 'http://127.0.0.1:8546', ROLLUP, SEQ_KEY: SEQK, BATCH_SEC: '60', L1_POLL_SEC: '3' } });
const stop = () => { node.kill(); anvil.kill(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop); node.on('exit', stop);
