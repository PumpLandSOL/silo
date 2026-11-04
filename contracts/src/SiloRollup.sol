// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.24;

/// @title SILO rollup: settlement + bridge for the SILO private L2, on Robinhood Chain.
/// @notice ETH deposited here is credited on the L2 as a shielded output to the given SILO address.
///         The sequencer posts every batch of L2 blocks here (state root + tx root), and pays the
///         withdrawals ("exits") that L2 transactions created. Stage 0: the sequencer is trusted to post
///         honest roots; the roots, deposits and exits are all public and permanent on this chain.
contract SiloRollup {
    uint256 public constant UNIT = 1e12;           // 1 L2 unit = 1 micro-ETH = 1e12 wei
    uint256 public constant MIN_DEPOSIT = 1e15;    // 0.001 ETH

    struct Batch { bytes32 stateRoot; bytes32 txRoot; uint64 fromBlock; uint64 toBlock; uint64 ts; }
    struct Exit { bytes32 txid; address to; uint256 amount; }   // amount in wei

    address public owner;
    address public sequencer;
    uint64 public batches;
    uint64 public lastBlock;
    uint256 public depositCount;
    uint256 public totalDeposited;
    uint256 public totalExited;
    mapping(uint64 => Batch) public batch;
    mapping(bytes32 => bool) public exited;

    event Deposit(uint256 indexed id, address indexed from, uint256 amount, bytes l2addr);
    event BatchPosted(uint64 indexed n, uint64 fromBlock, uint64 toBlock, bytes32 stateRoot, bytes32 txRoot, uint256 exits);
    event Exited(bytes32 indexed txid, address indexed to, uint256 amount);
    event SequencerSet(address sequencer);

    error NotSequencer(); error NotOwner(); error BadDeposit(); error BadBatch(); error AlreadyExited(); error PayFailed();

    constructor(address _sequencer) { owner = msg.sender; sequencer = _sequencer; emit SequencerSet(_sequencer); }

    /// @param l2addr a SILO address (silo1… or siloq1…) as UTF-8 bytes; the L2 mints the deposit to it.
    function deposit(bytes calldata l2addr) external payable {
        if (msg.value < MIN_DEPOSIT || msg.value % UNIT != 0 || l2addr.length < 60 || l2addr.length > 2000) revert BadDeposit();
        uint256 id = ++depositCount;
        totalDeposited += msg.value;
        emit Deposit(id, msg.sender, msg.value, l2addr);
    }

    function postBatch(uint64 n, uint64 fromBlock, uint64 toBlock, bytes32 stateRoot, bytes32 txRoot, Exit[] calldata exits) external {
        if (msg.sender != sequencer) revert NotSequencer();
        if (n != batches + 1 || toBlock < fromBlock || (batches > 0 && fromBlock != lastBlock + 1)) revert BadBatch();
        batches = n; lastBlock = toBlock;
        batch[n] = Batch(stateRoot, txRoot, fromBlock, toBlock, uint64(block.timestamp));
        for (uint256 i = 0; i < exits.length; i++) {
            Exit calldata e = exits[i];
            if (exited[e.txid]) revert AlreadyExited();
            exited[e.txid] = true;
            totalExited += e.amount;
            (bool ok, ) = e.to.call{value: e.amount}("");
            if (!ok) revert PayFailed();
            emit Exited(e.txid, e.to, e.amount);
        }
        emit BatchPosted(n, fromBlock, toBlock, stateRoot, txRoot, exits.length);
    }

    function setSequencer(address s) external { if (msg.sender != owner) revert NotOwner(); sequencer = s; emit SequencerSet(s); }
    function setOwner(address o) external { if (msg.sender != owner) revert NotOwner(); owner = o; }
}
