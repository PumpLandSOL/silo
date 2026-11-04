# SILO

A private layer 2 that settles to **Robinhood Chain** (chain id 4663).

Deposit ETH into the `SiloRollup` contract on Robinhood Chain and it appears on SILO as a shielded output. Send it with the sender, receiver and amount hidden. Withdraw any amount back to a `0x` address: the next batch posted to Robinhood Chain pays it.

## What is real

| Piece | Where |
|---|---|
| Settlement + bridge contract | `contracts/src/SiloRollup.sol` (Foundry tests: `npm run test:contracts`, 7/7) |
| Private transactions | `client/rct.js`: 16-member MLSAG ring signatures + key images, stealth one-time outputs, Pedersen commitments with 48-bit range proofs, ML-KEM-768 payment detection for `siloq1` addresses, public exits bound into the signed message |
| Sequencer node | `server/index.js`: keccak-linked L2 blocks signed with the sequencer's secp256k1 key, reads `Deposit` events, posts `postBatch(stateRoot, txRoot, exits)` |
| Wallet | `client/wallet.html`: keys, scanning and proving all run in the browser; deposits go through your EVM wallet |
| Explorer | `client/explorer.html`: blocks, private txs, batches, deposits, withdrawals, and a button that re-verifies any transaction in your browser |

Tests: `npm test` (crypto, 17/17) and `npm run test:e2e` (15/15: deploys the contract on a local chain, deposits real ETH, sends privately, withdraws, checks the contract paid it, restarts the node and checks nothing is paid twice).

## Trust model

Stage 0 rollup: one sequencer orders transactions and posts batches, and the contract trusts it to post honest roots. Deposits, batch roots and withdrawals are public on Robinhood Chain. Roadmap: validity proofs per batch, then a forced-exit path.

## Run

```
npm install
node _studio/dev.mjs          # local chain + contract + node on :8272 (needs Foundry)
```

Production env: `SEQ_KEY` (sequencer private key, funded with a little ETH on Robinhood Chain), `ROLLUP` (contract address), `ROLLUP_FROM_BLOCK` (deploy block), `DATA_PATH` (on a persistent disk), optional `SILO_MINT`, `BATCH_SEC` (default 300).

Deploy the contract:

```
cd contracts
forge create src/SiloRollup.sol:SiloRollup --rpc-url https://rpc.mainnet.chain.robinhood.com --private-key $DEPLOYER_KEY --broadcast --constructor-args <sequencer address>
```

License: BSD-3-Clause.
