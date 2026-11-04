# SILO

A private layer 2 that settles to **Robinhood Chain** (chain id 4663). Site: https://silonetwork.org · X: [@SiloNetworkRH](https://x.com/SiloNetworkRH)

Deposit ETH into the `SiloRollup` contract on Robinhood Chain and it appears on SILO as a shielded output. Send it with the sender, receiver and amount hidden. Withdraw any amount back to a `0x` address: the next batch posted to Robinhood Chain pays it.

## Mainnet

| | |
|---|---|
| SiloRollup | [`0xa20F8a5F5E0c56bdea639aa19769CA0624e92dcb`](https://explorer.mainnet.chain.robinhood.com/address/0xa20F8a5F5E0c56bdea639aa19769CA0624e92dcb) |
| Deploy tx | [`0x3bf06e2f…df48f`](https://explorer.mainnet.chain.robinhood.com/tx/0x3bf06e2fd7c9adb8b29a890e794897880dc397e55b4f38abd52357c8419df48f) (block 106261601) |
| Sequencer | `0x62Ef6296854E860FeB39E6aC4A7e085FbDDf6cD6` |
| Compiler | solc 0.8.24, EVM paris, no optimizer. Standard JSON input for source verification: `contracts/verify/` |

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
