// writes brand/X-KIT.md and checks every tweet is ≤245 characters.  node _studio/tweets.cjs
'use strict';
const fs = require('fs'), path = require('path'), len = (s) => [...s].length;
const BIO = 'A private layer 2 on Robinhood Chain. Deposit ETH, send it with the sender, receiver and amount hidden, withdraw any time. Every batch settles on-chain. $SILO';
const T = [
['Pinned · hype', 'silo-hype-16s.mp4', `Every transaction on Robinhood Chain happens in the light.

SILO is the moon that passes in front of it: a private layer 2 where the sender, receiver and amount never touch the ledger.

Every batch still settles on Robinhood Chain.

$SILO`],
['Phases (video)', 'silo-payment-15s.mp4', `Four phases, one shadow:

1. Deposit ETH into SiloRollup on Robinhood Chain
2. It's minted to you as a hidden output
3. Send it: ring of 16, no amount on the ledger
4. Withdraw to any 0x address, paid in the next batch

$SILO`],
['Key art', 'silo-g01-keyart.png', `Your money, in the dark.

SILO is a private layer 2 that settles to Robinhood Chain. Your balance, your payments and the people you pay stay off the public ledger.

$SILO`],
['Public vs dark', 'silo-g03-record.png', `What SILO keeps public, on Robinhood Chain: deposits, batch roots, withdrawals, the contract.

What it keeps dark: who sent it, who received it, how much, and which coin was spent.

Dark inside. On record outside.`],
['Comparison', 'silo-g04-matrix.png', `Tornado hides a link.
Railgun, Aztec and Monero hide sender, receiver and amount.

SILO does too, on Robinhood Chain, with ML-KEM-768 quantum-safe payment detection and a button that re-verifies any tx in your browser.

$SILO`],
['Instruments', 'silo-g05-instruments.png', `What's inside SILO:

Ring signatures over 16 outputs + key images
A fresh stealth key per payment
Pedersen commitments, 48-bit range proofs
ML-KEM-768 for siloq1 addresses
SiloRollup on Robinhood Chain

$SILO`],
['Settlement', 'silo-g06-settle.png', `Every few minutes, SILO posts a batch to SiloRollup on Robinhood Chain: a state root, a tx root, and the withdrawals to pay.

The contract pays each withdrawal exactly once. Anyone can read every batch on the explorer.

$SILO`],
['Verify yourself', 'silo-g05-instruments.png', `Don't trust the explorer. Check it.

Open any SILO transaction and press "verify in your browser". Your machine re-runs the ring signatures, range proofs and balance check from the raw tx.

$SILO`],
['Quantum', 'silo-g01-keyart.png', `Someone can record Robinhood Chain today and wait for a quantum computer.

SILO's siloq1 addresses detect payments with ML-KEM-768, a lattice scheme. Q-day can't link those payments back to you.

$SILO`],
['Sun and moon', 'silo-g08-sun.png', `Robinhood Chain is the sun. SILO is the moon.

The bridge, the batches and the withdrawals stay in the light. What passes in front goes dark.

$SILO`],
['Roadmap', 'silo-g07-roadmap.png', `SILO roadmap:

✓ private L2: ring-16 transfers, stealth + ML-KEM addresses
✓ SiloRollup: deposits, batches, paid withdrawals
→ shielded Robinhood Chain stocks
→ validity proofs per batch
→ forced exits

$SILO`],
['Launch (fill CA)', 'silo-g01-keyart.png', `$SILO is live.

A private layer 2 on Robinhood Chain. Deposit ETH, send it unseen, withdraw any time.

CA: <paste CA>

@SiloNetworkRH`],
];
let bad = 0, md = `# SILO X kit\n\n## Handle\n\`\`\`\n@SiloNetworkRH\n\`\`\`\n\n## Display name\n\`\`\`\nSILO | $SILO\n\`\`\`\n\n## Bio (${len(BIO)}/160)\n\`\`\`\n${BIO}\n\`\`\`\n\n## Profile images\n- Avatar: \`silo-pfp.png\`\n- Header: \`silo-banner.png\`\n\n## Tweets (all ≤245)\n`;
T.forEach(([name, media, text], i) => { const n = len(text); if (n > 245) { bad++; console.log('TOO LONG', i + 1, n); } console.log(i + 1, n, name); md += `\n### ${i + 1}. ${name} · ${n} chars · media: \`${media}\`\n\`\`\`\n${text}\n\`\`\`\n`; });
if (len(BIO) > 160) { bad++; console.log('BIO TOO LONG', len(BIO)); }
fs.writeFileSync(path.join(__dirname, '..', 'brand', 'X-KIT.md'), md); console.log(bad ? 'FIX' : 'all fit', 'bio', len(BIO));
