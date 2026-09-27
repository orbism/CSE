// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {EngineV2} from "./mocks/EngineV2.sol";

contract CubicSymmetryEngineTest is Test {
    CubicSymmetryEngine internal cse;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal bob = address(0xCA11);
    address internal royalty = address(0xF00D);

    uint256 internal constant PRICE = 0.005 ether;
    string internal constant BASE = "ipfs://bafyMetadata/";
    bytes32 internal constant PROVENANCE = keccak256("canonical id:seed table");
    string internal constant SEED = "CUBIC-SYMMETRY-ENGINE";

    function setUp() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory data = abi.encodeCall(
            CubicSymmetryEngine.initialize, (owner, PRICE, BASE, royalty, 500, PROVENANCE, SEED)
        );
        cse = CubicSymmetryEngine(address(new ERC1967Proxy(address(impl), data)));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    /// ids [from, from+n)
    function _ids(uint256 from, uint256 n) internal pure returns (uint256[] memory a) {
        a = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) a[i] = from + i;
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _openMint() internal {
        vm.prank(owner);
        cse.setMintState(CubicSymmetryEngine.MintState.LIVE);
    }

    /// @dev Buys out the whole public allocation. The wallet cap does not divide
    /// it evenly, so the last buyer takes the remainder rather than a full 20.
    function _drainPublic(uint160 firstBuyer) internal {
        uint256 remaining = cse.MAX_SUPPLY() - cse.RESERVE();
        uint256 next = 1;
        uint256 i = 0;
        while (remaining > 0) {
            uint256 n = remaining < cse.MAX_PER_WALLET() ? remaining : cse.MAX_PER_WALLET();
            address buyer = address(firstBuyer + uint160(i));
            vm.deal(buyer, 1 ether);
            vm.prank(buyer);
            cse.mint{value: PRICE * n}(_ids(next, n));
            next += n;
            remaining -= n;
            ++i;
        }
    }

    // ------------------------------------------------------------ initialisation

    function test_initialState() public view {
        assertEq(cse.name(), "Cubic Symmetry Engine");
        assertEq(cse.symbol(), "CSE");
        assertEq(cse.owner(), owner);
        assertEq(cse.price(), PRICE);
        assertEq(cse.MAX_SUPPLY(), 512);
        assertEq(cse.RESERVE(), 11);
        assertEq(cse.MAX_PER_WALLET(), 20);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.CLOSED));
        assertEq(cse.remainingPublic(), 501);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        cse.initialize(owner, PRICE, BASE, royalty, 500, PROVENANCE, SEED);
    }

    function test_implementationIsLocked() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        vm.expectRevert();
        impl.initialize(owner, PRICE, BASE, royalty, 500, PROVENANCE, SEED);
    }

    // -------------------------------------------------------------------- mint

    function test_mintRevertsWhenClosed() public {
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.MintNotLive.selector);
        cse.mint{value: PRICE}(_one(1));
    }

    function test_mintSucceedsWhenLive() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE * 3}(_ids(1, 3));

        assertEq(cse.balanceOf(alice), 3);
        assertEq(cse.totalSupply(), 3);
        assertEq(cse.ownerOf(1), alice);
        assertEq(cse.ownerOf(3), alice);
        assertEq(cse.mintedBy(alice), 3);
        assertEq(address(cse).balance, PRICE * 3);
    }

    function test_mintRejectsUnderpayment() public {
        _openMint();
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE * 2 - 1}(_ids(1, 2));
    }

    function test_mintRejectsOverpayment() public {
        _openMint();
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE * 2 + 1}(_ids(1, 2));
    }

    function test_mintRejectsZeroQuantity() public {
        _openMint();
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.InvalidQuantity.selector);
        cse.mint{value: 0}(new uint256[](0));
    }

    function test_walletCapEnforcedInOneCall() public {
        _openMint();
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.WalletLimitExceeded.selector);
        cse.mint{value: PRICE * 21}(_ids(1, 21));
    }

    function test_walletCapEnforcedAcrossCalls() public {
        _openMint();
        vm.startPrank(alice);
        cse.mint{value: PRICE * 20}(_ids(1, 20));
        assertEq(cse.balanceOf(alice), 20);
        vm.expectRevert(CubicSymmetryEngine.WalletLimitExceeded.selector);
        cse.mint{value: PRICE}(_one(1));
        vm.stopPrank();

        // a different wallet is unaffected, on an id alice did not take
        vm.prank(bob);
        cse.mint{value: PRICE}(_one(21));
        assertEq(cse.balanceOf(bob), 1);
        assertEq(cse.ownerOf(21), bob);
    }

    function test_publicMintCannotConsumeReserve() public {
        _openMint();
        // drain the 501 public allocation across many wallets
        _drainPublic(0x1000);
        assertEq(cse.totalSupply(), 501);
        assertEq(cse.remainingPublic(), 0);

        address late = address(0xDEAD01);
        vm.deal(late, 1 ether);
        vm.prank(late);
        vm.expectRevert(CubicSymmetryEngine.SupplyExhausted.selector);
        cse.mint{value: PRICE}(_one(502));

        // the reserve is still claimable and completes the supply
        vm.prank(owner);
        cse.reserveMint(owner, _ids(502, 11));
        assertEq(cse.totalSupply(), 512);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.SOLD_OUT));
    }

    function test_mintFlipsToSoldOutAtCap() public {
        _openMint();
        vm.prank(owner);
        cse.reserveMint(owner, _ids(502, 11));
        _drainPublic(0x2000);
        assertEq(cse.totalSupply(), 512);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.SOLD_OUT));

        address late = address(0xDEAD02);
        vm.deal(late, 1 ether);
        vm.prank(late);
        vm.expectRevert(CubicSymmetryEngine.MintNotLive.selector);
        cse.mint{value: PRICE}(_one(1));
    }

    function test_priceChangeAppliesToNextMint() public {
        _openMint();
        vm.prank(owner);
        cse.setPrice(0.01 ether);

        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: PRICE}(_one(1));

        vm.prank(alice);
        cse.mint{value: 0.01 ether}(_one(1));
        assertEq(cse.balanceOf(alice), 1);
    }

    // ------------------------------------------------------- choosing your id

    function test_mintsTheExactIdRequested() public {
        _openMint();
        uint256[] memory pick = new uint256[](3);
        (pick[0], pick[1], pick[2]) = (417, 9, 499);
        vm.prank(alice);
        cse.mint{value: PRICE * 3}(pick);

        assertEq(cse.ownerOf(417), alice);
        assertEq(cse.ownerOf(9), alice);
        assertEq(cse.ownerOf(499), alice);
        assertEq(cse.totalSupply(), 3);
        // nothing sequential was handed out
        vm.expectRevert();
        cse.ownerOf(1);
    }

    function test_cannotMintATakenId() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE}(_one(417));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.AlreadyMinted.selector, 417));
        cse.mint{value: PRICE}(_one(417));
    }

    function test_cannotMintTheSameIdTwiceInOneCall() public {
        _openMint();
        uint256[] memory dup = new uint256[](2);
        (dup[0], dup[1]) = (5, 5);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CubicSymmetryEngine.AlreadyMinted.selector, 5));
        cse.mint{value: PRICE * 2}(dup);
    }

    function test_rejectsOutOfRangeIds() public {
        _openMint();
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.InvalidTokenId.selector);
        cse.mint{value: PRICE}(_one(0));

        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.InvalidTokenId.selector);
        cse.mint{value: PRICE}(_one(513));
    }

    function test_isAvailable() public {
        _openMint();
        assertTrue(cse.isAvailable(417));
        vm.prank(alice);
        cse.mint{value: PRICE}(_one(417));
        assertFalse(cse.isAvailable(417));
        assertFalse(cse.isAvailable(0));
        assertFalse(cse.isAvailable(513));
    }

    function test_mintedBitmapTracksTakenIds() public {
        _openMint();
        uint256[] memory pick = new uint256[](4);
        (pick[0], pick[1], pick[2], pick[3]) = (1, 256, 257, 512);
        vm.prank(alice);
        cse.mint{value: PRICE * 4}(pick);

        uint256[] memory bits = cse.mintedBitmap();
        assertEq(bits.length, 2); // ceil(512 / 256)

        for (uint256 i = 0; i < pick.length; ++i) {
            uint256 id = pick[i];
            assertTrue(bits[(id - 1) >> 8] & (1 << ((id - 1) & 0xff)) != 0, "should be set");
        }
        // a neighbour of a taken id stays clear
        assertTrue(bits[0] & (1 << 1) == 0, "id 2 should be free");
    }

    // ----------------------------------------------------------------- reserve

    function test_reserveMintOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.reserveMint(alice, _one(1));
    }

    function test_reserveCapEnforced() public {
        vm.startPrank(owner);
        cse.reserveMint(owner, _ids(502, 11));
        vm.expectRevert(CubicSymmetryEngine.ReserveExhausted.selector);
        cse.reserveMint(owner, _one(501));
        vm.stopPrank();
        assertEq(cse.totalSupply(), 11);
    }

    function test_reserveMintWorksWhileClosed() public {
        vm.prank(owner);
        cse.reserveMint(alice, _ids(1, 2));
        assertEq(cse.balanceOf(alice), 2);
        assertEq(uint8(cse.mintState()), uint8(CubicSymmetryEngine.MintState.CLOSED));
    }

    // -------------------------------------------------------------- token URI

    function test_tokenURI() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE}(_one(1));
        assertEq(cse.tokenURI(1), string.concat(BASE, "1.json"));
    }

    function test_tokenURIRevertsForUnminted() public {
        vm.expectRevert();
        cse.tokenURI(1);
    }

    function test_setBaseURI() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE}(_one(1));

        vm.prank(owner);
        cse.setBaseURI("ipfs://newCID/");
        assertEq(cse.tokenURI(1), "ipfs://newCID/1.json");
        assertEq(cse.baseURI(), "ipfs://newCID/");
    }

    function test_setBaseURIOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.setBaseURI("ipfs://evil/");
    }

    // ------------------------------------------------------------- provenance

    function test_provenanceCommittedAtInit() public view {
        assertEq(cse.provenanceHash(), PROVENANCE);
        assertEq(cse.masterSeed(), SEED);
        assertFalse(cse.metadataFrozen());
    }

    /// The commitment is worthless if it can be revised, so there is no setter
    /// at all — not an owner-gated one. This asserts the ABI has no way in.
    function test_provenanceHasNoSetter() public {
        assertFalse(_hasSelector(bytes4(keccak256("setProvenanceHash(bytes32)"))));
        assertFalse(_hasSelector(bytes4(keccak256("setMasterSeed(string)"))));
        // still the committed value after those calls bounced
        assertEq(cse.provenanceHash(), PROVENANCE);
        assertEq(cse.masterSeed(), SEED);
    }

    function test_freezeMetadataStopsFurtherChanges() public {
        vm.prank(owner);
        cse.setBaseURI("ipfs://final/");

        vm.prank(owner);
        cse.freezeMetadata();
        assertTrue(cse.metadataFrozen());

        vm.prank(owner);
        vm.expectRevert(CubicSymmetryEngine.MetadataAlreadyFrozen.selector);
        cse.setBaseURI("ipfs://afterwards/");

        // and the URI that was frozen is the one that stays
        assertEq(cse.baseURI(), "ipfs://final/");
    }

    function test_freezeMetadataOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.freezeMetadata();
    }

    function test_freezeMetadataIsOneWay() public {
        vm.startPrank(owner);
        cse.freezeMetadata();
        vm.expectRevert(CubicSymmetryEngine.MetadataAlreadyFrozen.selector);
        cse.freezeMetadata();
        vm.stopPrank();
    }

    /// @dev A call to a non-existent function on a contract with no fallback
    /// reverts; that is how we assert a selector is absent.
    function _hasSelector(bytes4 selector) internal returns (bool) {
        (bool ok, ) = address(cse).call(abi.encodePacked(selector, bytes32(0)));
        return ok;
    }

    // -------------------------------------------------------------- royalties

    function test_royaltyInfo() public view {
        (address receiver, uint256 amount) = cse.royaltyInfo(1, 1 ether);
        assertEq(receiver, royalty);
        assertEq(amount, 0.05 ether); // 500 bps
    }

    function test_supportsInterfaces() public view {
        assertTrue(cse.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(cse.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(cse.supportsInterface(0x2a55205a)); // ERC2981
    }

    // --------------------------------------------------------------- withdraw

    function test_withdraw() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE * 5}(_ids(1, 5));

        uint256 before = owner.balance;
        vm.prank(owner);
        cse.withdraw(payable(owner));
        assertEq(owner.balance - before, PRICE * 5);
        assertEq(address(cse).balance, 0);
    }

    function test_withdrawOwnerOnly() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE}(_one(1));

        vm.prank(alice);
        vm.expectRevert();
        cse.withdraw(payable(alice));
    }

    function test_withdrawRevertsWhenEmpty() public {
        vm.prank(owner);
        vm.expectRevert(CubicSymmetryEngine.NothingToWithdraw.selector);
        cse.withdraw(payable(owner));
    }

    // --------------------------------------------------------------- upgrades

    function test_upgradePreservesState() public {
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE * 4}(_ids(1, 4));
        vm.prank(owner);
        cse.reserveMint(bob, _ids(502, 2));

        EngineV2 v2impl = new EngineV2();
        vm.prank(owner);
        cse.upgradeToAndCall(address(v2impl), "");

        EngineV2 upgraded = EngineV2(address(cse));
        assertEq(upgraded.version(), "v2");
        // every pre-upgrade slot survives
        assertEq(upgraded.totalSupply(), 6);
        assertEq(upgraded.balanceOf(alice), 4);
        assertEq(upgraded.balanceOf(bob), 2);
        assertEq(upgraded.ownerOf(1), alice);
        assertEq(upgraded.ownerOf(502), bob);
        assertEq(upgraded.mintedBy(alice), 4);
        assertEq(upgraded.reserveMinted(), 2);
        assertEq(upgraded.price(), PRICE);
        assertEq(upgraded.owner(), owner);
        assertEq(uint8(upgraded.mintState()), uint8(CubicSymmetryEngine.MintState.LIVE));
        assertEq(upgraded.tokenURI(1), string.concat(BASE, "1.json"));
    }

    function test_upgradeOwnerOnly() public {
        EngineV2 v2impl = new EngineV2();
        vm.prank(alice);
        vm.expectRevert();
        cse.upgradeToAndCall(address(v2impl), "");
    }

    function test_mintStillWorksAfterUpgrade() public {
        _openMint();
        EngineV2 v2impl = new EngineV2();
        vm.prank(owner);
        cse.upgradeToAndCall(address(v2impl), "");

        vm.prank(alice);
        EngineV2(address(cse)).mint{value: PRICE * 2}(_ids(1, 2));
        assertEq(cse.balanceOf(alice), 2);
    }

    // ------------------------------------------------------------------- fuzz

    function testFuzz_mintQuantityWithinCap(uint8 qty) public {
        qty = uint8(bound(qty, 1, 20));
        _openMint();
        vm.prank(alice);
        cse.mint{value: PRICE * qty}(_ids(1, qty));
        assertEq(cse.balanceOf(alice), qty);
        assertEq(cse.totalSupply(), qty);
    }

    function testFuzz_exactPaymentRequired(uint96 value) public {
        _openMint();
        vm.assume(value != PRICE);
        vm.deal(alice, uint256(value) + 1 ether);
        vm.prank(alice);
        vm.expectRevert(CubicSymmetryEngine.IncorrectPayment.selector);
        cse.mint{value: value}(_one(1));
    }
}
