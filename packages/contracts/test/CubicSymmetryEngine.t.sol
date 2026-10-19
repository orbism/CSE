// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {EngineV2} from "./mocks/EngineV2.sol";

contract CubicSymmetryEngineTest is Test {
    CubicSymmetryEngine internal cse;
    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal bob = address(0xCA11);
    address internal royalty = address(0xF00D);
    uint256 internal signerPk = 0x5167;
    address internal signer;
    uint256 internal constant PRICE = 0.005 ether;
    string internal constant BASE = "ipfs://bafyMetadata/";

    function setUp() public {
        signer = vm.addr(signerPk);
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory data =
            abi.encodeCall(CubicSymmetryEngine.initialize, (owner, PRICE, BASE, royalty, 500, signer));
        cse = CubicSymmetryEngine(address(new ERC1967Proxy(address(impl), data)));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------------- helpers

    function _seed(uint256 n) internal pure returns (bytes32) {
        return keccak256(abi.encode("seed", n));
    }

    function _seeds(uint256 from, uint256 n) internal pure returns (bytes32[] memory a) {
        a = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) a[i] = _seed(from + i);
    }

    function _sig(uint256 pk, address minter, bytes32 seed, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, cse.mintDigest(minter, seed, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _approve(address minter, bytes32 seed) internal view returns (uint256 deadline, bytes memory sig) {
        deadline = block.timestamp + 600;
        sig = _sig(signerPk, minter, seed, deadline);
    }

    /// Mint `seed` as `who`, with a fresh approval.
    function _mintAs(address who, bytes32 seed) internal {
        (uint256 deadline, bytes memory sig) = _approve(who, seed);
        vm.prank(who);
        cse.mint{value: PRICE}(seed, deadline, sig);
    }

    function _openMint() internal {
        vm.prank(owner);
        cse.setMintState(CubicSymmetryEngine.MintState.LIVE);
    }

    /// @dev Buys out the whole public allocation, 20 per wallet, seeds from `firstSeed`.
    function _drainPublic(uint160 firstBuyer, uint256 firstSeed) internal {
        uint256 remaining = cse.remainingPublic();
        uint256 n = firstSeed;
        for (uint256 w = 0; remaining > 0; ++w) {
            address buyer = address(firstBuyer + uint160(w));
            vm.deal(buyer, 1 ether);
            uint256 take = remaining < cse.MAX_PER_WALLET() ? remaining : cse.MAX_PER_WALLET();
            for (uint256 i = 0; i < take; ++i) _mintAs(buyer, _seed(n++));
            remaining -= take;
        }
    }

    // ---------------------------------------------------------------- init

    function test_initialState() public view {
        assertEq(cse.name(), "Cubic Symmetry Engine");
        assertEq(cse.symbol(), "CSE");
        assertEq(cse.owner(), owner);
        assertEq(cse.signer(), signer);
        assertEq(cse.price(), PRICE);
        assertEq(cse.MAX_SUPPLY(), 512);
        assertEq(cse.RESERVE(), 11);
        assertEq(cse.MAX_PER_WALLET(), 20);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.CLOSED));
        assertEq(cse.totalSupply(), 0);
        assertEq(cse.remainingPublic(), 501);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        cse.initialize(owner, PRICE, BASE, royalty, 500, signer);
    }

    function test_implementationIsLocked() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        vm.expectRevert();
        impl.initialize(owner, PRICE, BASE, royalty, 500, signer);
    }

    function test_initRejectsZeroSigner() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory data =
            abi.encodeCall(CubicSymmetryEngine.initialize, (owner, PRICE, BASE, royalty, 500, address(0)));
        vm.expectRevert(CubicSymmetryEngine.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), data);
    }

    // ---------------------------------------------------------------- mint

    function test_mintRevertsWhenClosed() public {
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.MintNotLive.selector);
        cse.mint{value: PRICE}(_seed(1), d, s);
    }

    function test_mintWritesSeedAndSequentialId() public {
        _openMint();
        vm.expectEmit(true, true, true, true);
        emit CubicSymmetryEngine.Minted(1, _seed(1), alice);
        _mintAs(alice, _seed(1));
        _mintAs(bob, _seed(2));

        assertEq(cse.ownerOf(1), alice);
        assertEq(cse.ownerOf(2), bob);
        assertEq(cse.seedOf(1), _seed(1));
        assertEq(cse.tokenOfSeed(_seed(2)), 2);
        assertEq(cse.totalSupply(), 2);
        assertEq(cse.mintedBy(alice), 1);
        assertEq(address(cse).balance, PRICE * 2);
    }

    function test_mintRejectsWrongPayment() public {
        _openMint();
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.startPrank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE - 1}(_seed(1), d, s);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE + 1}(_seed(1), d, s);
        vm.stopPrank();
    }

    function test_mintRejectsExpiredApproval() public {
        _openMint();
        uint256 deadline = block.timestamp + 10;
        bytes memory s = _sig(signerPk, alice, _seed(1), deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.ApprovalExpired.selector);
        cse.mint{value: PRICE}(_seed(1), deadline, s);
    }

    function test_mintRejectsUnapprovedSigner() public {
        _openMint();
        uint256 deadline = block.timestamp + 600;
        bytes memory s = _sig(0xBAD, alice, _seed(1), deadline);
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.BadSignature.selector);
        cse.mint{value: PRICE}(_seed(1), deadline, s);
    }

    /// An approval names its minter: a roll seen in the mempool is useless to anyone else.
    function test_approvalCannotBeSniped() public {
        _openMint();
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.prank(bob);
        vm.expectRevert(CubicSymmetryEngine.BadSignature.selector);
        cse.mint{value: PRICE}(_seed(1), d, s);
    }

    function test_approvalBindsTheSeed() public {
        _openMint();
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.BadSignature.selector);
        cse.mint{value: PRICE}(_seed(2), d, s);
    }

    function test_seedMintsOnce() public {
        _openMint();
        _mintAs(alice, _seed(1));
        (uint256 d, bytes memory s) = _approve(bob, _seed(1));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.SeedTaken.selector, _seed(1)));
        cse.mint{value: PRICE}(_seed(1), d, s);
    }

    function test_zeroSeedRejected() public {
        _openMint();
        (uint256 d, bytes memory s) = _approve(alice, bytes32(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.SeedTaken.selector, bytes32(0)));
        cse.mint{value: PRICE}(bytes32(0), d, s);
    }

    function test_walletCapEnforced() public {
        _openMint();
        for (uint256 i = 0; i < 20; ++i) _mintAs(alice, _seed(i));
        assertEq(cse.balanceOf(alice), 20);
        (uint256 d, bytes memory s) = _approve(alice, _seed(99));
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.WalletLimitExceeded.selector);
        cse.mint{value: PRICE}(_seed(99), d, s);
    }

    function test_publicMintCannotConsumeReserve() public {
        _openMint();
        _drainPublic(0x1000, 1000);
        assertEq(cse.totalSupply(), 501);
        assertEq(cse.remainingPublic(), 0);

        (uint256 d, bytes memory s) = _approve(alice, _seed(5000));
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.SupplyExhausted.selector);
        cse.mint{value: PRICE}(_seed(5000), d, s);

        // the owner can still claim every reserved piece
        vm.prank(owner);
        cse.reserveMint(owner, _seeds(9000, 11));
        assertEq(cse.totalSupply(), 512);
    }

    function test_mintFlipsToSoldOutAtCap() public {
        _openMint();
        vm.prank(owner);
        cse.reserveMint(owner, _seeds(9000, 11));
        _drainPublic(0x2000, 1000);
        assertEq(cse.totalSupply(), 512);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.SOLD_OUT));
    }

    function test_priceChangeAppliesToNextMint() public {
        _openMint();
        vm.prank(owner);
        cse.setPrice(0.01 ether);
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.startPrank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE}(_seed(1), d, s);
        cse.mint{value: 0.01 ether}(_seed(1), d, s);
        vm.stopPrank();
        assertEq(cse.ownerOf(1), alice);
    }

    function test_setSignerRotatesApprovals() public {
        _openMint();
        (uint256 d, bytes memory old) = _approve(alice, _seed(1));
        uint256 nextPk = 0x7777;
        vm.prank(owner);
        cse.setSigner(vm.addr(nextPk));

        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.BadSignature.selector);
        cse.mint{value: PRICE}(_seed(1), d, old);

        bytes memory fresh = _sig(nextPk, alice, _seed(1), d);
        vm.prank(alice);
        cse.mint{value: PRICE}(_seed(1), d, fresh);
        assertEq(cse.ownerOf(1), alice);
    }

    function test_setSignerOwnerOnlyAndNonZero() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.setSigner(alice);
        vm.prank(owner);
        vm.expectRevert(CubicSymmetryEngine.ZeroAddress.selector);
        cse.setSigner(address(0));
    }

    // -------------------------------------------------------------- reserve

    function test_reserveMintOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.reserveMint(alice, _seeds(1, 1));
    }

    function test_reserveCapEnforced() public {
        vm.startPrank(owner);
        cse.reserveMint(owner, _seeds(9000, 11));
        vm.expectRevert(CubicSymmetryEngine.ReserveExhausted.selector);
        cse.reserveMint(owner, _seeds(9500, 1));
        vm.stopPrank();
        assertEq(cse.totalSupply(), 11);
    }

    function test_reserveMintWorksWhileClosedAndRejectsReuse() public {
        vm.prank(owner);
        cse.reserveMint(alice, _seeds(1, 2));
        assertEq(cse.balanceOf(alice), 2);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.CLOSED));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.SeedTaken.selector, _seed(1)));
        cse.reserveMint(alice, _seeds(1, 1));
    }

    // ------------------------------------------------------------- metadata

    function test_tokenURIFallsBackToBaseURI() public {
        _openMint();
        _mintAs(alice, _seed(1));
        assertEq(cse.tokenURI(1), string.concat(BASE, "1.json"));
    }

    function test_tokenURIRevertsForUnminted() public {
        vm.expectRevert();
        cse.tokenURI(1);
    }

    function test_setBaseURI() public {
        _openMint();
        _mintAs(alice, _seed(1));
        vm.prank(owner);
        cse.setBaseURI("ipfs://other/");
        assertEq(cse.tokenURI(1), "ipfs://other/1.json");
        vm.prank(alice);
        vm.expectRevert();
        cse.setBaseURI("x");
    }

    function test_freezeMetadataIsOneWayAndOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.freezeMetadata();
        vm.startPrank(owner);
        cse.freezeMetadata();
        vm.expectRevert(CubicSymmetryEngine.MetadataAlreadyFrozen.selector);
        cse.setBaseURI("x");
        vm.expectRevert(CubicSymmetryEngine.MetadataAlreadyFrozen.selector);
        cse.setRenderer(address(1));
        vm.expectRevert(CubicSymmetryEngine.MetadataAlreadyFrozen.selector);
        cse.freezeMetadata();
        vm.stopPrank();
    }

    function test_royaltyInfo() public view {
        (address receiver, uint256 amount) = cse.royaltyInfo(1, 1 ether);
        assertEq(receiver, royalty);
        assertEq(amount, 0.05 ether);
    }

    function test_supportsInterfaces() public view {
        assertTrue(cse.supportsInterface(type(IERC721).interfaceId));
        assertTrue(cse.supportsInterface(type(IERC2981).interfaceId));
    }

    // -------------------------------------------------------------- withdraw

    function test_withdraw() public {
        _openMint();
        _mintAs(alice, _seed(1));
        _mintAs(alice, _seed(2));
        address payable to = payable(address(0xD00D));
        vm.prank(owner);
        cse.withdraw(to);
        assertEq(to.balance, PRICE * 2);
        assertEq(address(cse).balance, 0);
    }

    function test_withdrawOwnerOnlyAndRevertsWhenEmpty() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.withdraw(payable(alice));
        vm.prank(owner);
        vm.expectRevert(CubicSymmetryEngine.NothingToWithdraw.selector);
        cse.withdraw(payable(owner));
    }

    // --------------------------------------------------------------- upgrade

    function test_upgradePreservesState() public {
        _openMint();
        _mintAs(alice, _seed(1));
        address v2 = address(new EngineV2()); // created before the prank, which the CREATE would otherwise spend
        vm.prank(owner);
        cse.upgradeToAndCall(v2, "");
        EngineV2 upgraded = EngineV2(address(cse));
        assertEq(upgraded.version(), "v2");
        assertEq(upgraded.owner(), owner);
        assertEq(upgraded.signer(), signer);
        assertEq(upgraded.seedOf(1), _seed(1));
        assertEq(upgraded.ownerOf(1), alice);
        assertEq(upgraded.totalSupply(), 1);
        // and minting still works through the new implementation
        _mintAs(bob, _seed(2));
        assertEq(upgraded.ownerOf(2), bob);
    }

    function test_upgradeOwnerOnly() public {
        address impl = address(new EngineV2());
        vm.prank(alice);
        vm.expectRevert();
        cse.upgradeToAndCall(impl, "");
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_exactPaymentRequired(uint96 value) public {
        value = uint96(bound(value, 0, 50 ether));
        vm.assume(value != PRICE);
        _openMint();
        (uint256 d, bytes memory s) = _approve(alice, _seed(1));
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: value}(_seed(1), d, s);
    }

    function testFuzz_anySeedMintsOnceWithApproval(bytes32 seed) public {
        vm.assume(seed != bytes32(0));
        _openMint();
        _mintAs(alice, seed);
        assertEq(cse.tokenOfSeed(seed), 1);
        (uint256 d, bytes memory s) = _approve(bob, seed);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.SeedTaken.selector, seed));
        cse.mint{value: PRICE}(seed, d, s);
    }
}
