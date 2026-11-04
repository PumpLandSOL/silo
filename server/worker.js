// Proof worker: builds and verifies private transactions off the main thread so the API stays responsive.
import { parentPort } from 'node:worker_threads';
import * as K from '../client/rct.js';

parentPort.on('message', ({ id, op, args }) => {
  try {
    if (op === 'build') { const [ins, outs, fee, exit] = args; return parentPort.postMessage({ id, ok: K.buildTx(ins, outs, fee, exit) }); }
    if (op === 'verify') { const [tx, ring, spent] = args; const S = new Set(spent); return parentPort.postMessage({ id, ok: K.verifyTx(tx, (g) => ring[g], (k) => S.has(k)) }); }
    parentPort.postMessage({ id, err: 'unknown op' });
  } catch (e) { parentPort.postMessage({ id, err: String(e) }); }
});
