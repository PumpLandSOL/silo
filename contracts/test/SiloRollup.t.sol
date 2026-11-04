// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.24;
import "../src/SiloRollup.sol";

interface Vm { function prank(address) external; function deal(address, uint256) external; function expectRevert(bytes4) external; }

contract SiloRollupTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SiloRollup r; address seq = address(0xA11CE); address user = address(0xB0B); address payee = address(0xCAFE);
    bytes addr = bytes("siloq1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    function setUp() public { r = new SiloRollup(seq); vm.deal(user, 10 ether); }

    function testDeposit() public {
        vm.prank(user); r.deposit{value: 0.5 ether}(addr);
        require(r.depositCount() == 1 && r.totalDeposited() == 0.5 ether && address(r).balance == 0.5 ether, "deposit");
    }
    function testDepositRejectsDust() public {
        vm.prank(user); vm.expectRevert(SiloRollup.BadDeposit.selector); r.deposit{value: 1e15 + 1}(addr);
    }
    function testDepositRejectsTiny() public {
        vm.prank(user); vm.expectRevert(SiloRollup.BadDeposit.selector); r.deposit{value: 1e14}(addr);
    }
    function testBatchAndExit() public {
        vm.prank(user); r.deposit{value: 1 ether}(addr);
        SiloRollup.Exit[] memory ex = new SiloRollup.Exit[](1); ex[0] = SiloRollup.Exit(keccak256("tx1"), payee, 0.25 ether);
        vm.prank(seq); r.postBatch(1, 0, 9, bytes32(uint256(1)), bytes32(uint256(2)), ex);
        require(payee.balance == 0.25 ether && r.batches() == 1 && r.lastBlock() == 9 && r.totalExited() == 0.25 ether, "exit");
        SiloRollup.Exit[] memory none = new SiloRollup.Exit[](0);
        vm.prank(seq); r.postBatch(2, 10, 20, bytes32(uint256(3)), bytes32(uint256(4)), none);
        require(r.batches() == 2, "batch 2");
    }
    function testNoDoubleExit() public {
        vm.prank(user); r.deposit{value: 1 ether}(addr);
        SiloRollup.Exit[] memory ex = new SiloRollup.Exit[](1); ex[0] = SiloRollup.Exit(keccak256("tx1"), payee, 0.1 ether);
        vm.prank(seq); r.postBatch(1, 0, 1, 0, 0, ex);
        vm.prank(seq); vm.expectRevert(SiloRollup.AlreadyExited.selector); r.postBatch(2, 2, 3, 0, 0, ex);
    }
    function testOnlySequencer() public {
        SiloRollup.Exit[] memory none = new SiloRollup.Exit[](0);
        vm.prank(user); vm.expectRevert(SiloRollup.NotSequencer.selector); r.postBatch(1, 0, 1, 0, 0, none);
    }
    function testBatchesMustChain() public {
        SiloRollup.Exit[] memory none = new SiloRollup.Exit[](0);
        vm.prank(seq); r.postBatch(1, 0, 5, 0, 0, none);
        vm.prank(seq); vm.expectRevert(SiloRollup.BadBatch.selector); r.postBatch(2, 7, 9, 0, 0, none);
    }
}
