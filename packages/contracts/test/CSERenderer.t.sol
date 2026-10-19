// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {CSERenderer} from "../src/CSERenderer.sol";
import {SSTORE2} from "../src/SSTORE2.sol";

/**
 * The renderer against a stand-in page tail and a hand-packed trait table.
 * Byte-for-byte correctness of the real page is checked end to end by
 * packages/generator/src/onchain-check.ts, which decodes a live tokenURI and
 * renders it; this covers the contract-side rules.
 */
contract CSERendererTest is Test {
    CubicSymmetryEngine cse;
    CSERenderer renderer;
    address owner = address(0xA11CE);
    address alice = address(0xB0B);
    uint256 signerPk = 0x5167;
    uint256 constant PRICE = 0.005 ether;
    string constant TAIL = "<meta name=viewport><body>tail</body></html>"; // 44 bytes: padded to 45 below

    function setUp() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory init = abi.encodeCall(
            CubicSymmetryEngine.initialize, (owner, PRICE, PRICE, "ipfs://x/", owner, 500, vm.addr(signerPk))
        );
        cse = CubicSymmetryEngine(address(new ERC1967Proxy(address(impl), init)));

        bytes memory tail = bytes(TAIL);
        while (tail.length % 3 != 0) tail = abi.encodePacked(tail, " ");
        bytes memory enc = bytes(Base64.encode(tail));
        // split the encoded tail across two pointers, as the deploy does
        bytes memory a = new bytes(20);
        bytes memory b = new bytes(enc.length - 20);
        for (uint256 i = 0; i < enc.length; ++i) {
            if (i < 20) a[i] = enc[i];
            else b[i - 20] = enc[i];
        }
        address[] memory parts = new address[](2);
        parts[0] = SSTORE2.write(a);
        parts[1] = SSTORE2.write(b);

        vm.prank(owner);
        renderer = new CSERenderer(address(cse), parts, "https://covers.example/");
        vm.prank(owner);
        cse.setRenderer(address(renderer));
        vm.prank(owner);
        cse.setMintState(CubicSymmetryEngine.MintState.PUBLIC);
        vm.deal(alice, 100 ether);
    }

    // ------------------------------------------------------------- helpers

    function _seed(uint256 n) internal pure returns (bytes32) {
        return keccak256(abi.encode("seed", n));
    }

    function _mintAs(address who, bytes32 seed) internal {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, cse.mintDigest(who, seed, deadline));
        vm.prank(who);
        cse.mint{value: PRICE}(seed, deadline, abi.encodePacked(r, s, v), new bytes32[](0));
    }

    /// Public-mint up to id `n`, continuing from wherever the supply is, across a rotation of wallets.
    function _mintMany(uint256 n) internal {
        for (uint256 i = cse.totalMinted() + 1; i <= n; ++i) {
            address who = address(uint160(0x1000 + i / 16));
            vm.deal(who, 1 ether);
            _mintAs(who, _seed(i));
        }
    }

    function _sellOut() internal {
        bytes32[] memory reserve = new bytes32[](11);
        for (uint256 i = 0; i < 11; ++i) reserve[i] = keccak256(abi.encode("reserve", i));
        _mintMany(501);
        vm.prank(owner);
        cse.reserveMint(owner, reserve);
        assertEq(cse.totalMinted(), 512);
    }

    /// #1: Lattice, 3 real, Transposed, Separated/High/ω0, Violent/Echo/AMBER, rank 14
    /// #7: Tessellation, 1 real 2 complex, Identity, Fractured/Mid/ω2, Still/None/PHOSPHOR, rank 300
    function _traitTable() internal pure returns (bytes memory t) {
        t = new bytes(512 * 8);
        _record(t, 1, 7, 0, 3, 0, 3, 0, 2, 1, 1, 14);
        _record(t, 7, 5, 1, 0, 1, 2, 2, 0, 0, 0, 300);
    }

    function _record(
        bytes memory t, uint256 id, uint8 structure, uint8 rootState, uint8 symmetry, uint8 discClass,
        uint8 discBand, uint8 phase, uint8 energy, uint8 feedback, uint8 palette, uint16 rank
    ) internal pure {
        uint256 o = (id - 1) * 8;
        t[o] = bytes1(structure);
        t[o + 1] = bytes1(rootState);
        t[o + 2] = bytes1(symmetry);
        t[o + 3] = bytes1(uint8(discClass | (discBand << 2) | (phase << 5)));
        t[o + 4] = bytes1(uint8(energy | (feedback << 2) | (palette << 4)));
        t[o + 5] = bytes1(uint8(rank >> 8));
        t[o + 6] = bytes1(uint8(rank));
    }

    function _reveal() internal {
        // the table is written first: a prank is spent by the next call frame,
        // and SSTORE2.write's CREATE would take it instead of reveal()
        address table = SSTORE2.write(_traitTable());
        vm.prank(owner);
        renderer.reveal(table);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j = 0; j < n.length && ok; ++j) ok = h[i + j] == n[j];
            if (ok) return true;
        }
        return false;
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i < b.length; ++i) if (a[i] != b[i]) return false;
        return true;
    }

    // ---- before the reveal

    function test_tokenURIBeforeRevealCarriesSeedAndPlaceholderTraits() public {
        _mintAs(alice, _seed(1));
        string memory uri = cse.tokenURI(1);
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
        assertEq(uri, renderer.tokenURI(1));
        assertEq(renderer.attributesJSON(1), '[{"trait_type":"Traits","value":"Revealed at sell-out"}]');
        assertFalse(renderer.revealed());
    }

    function test_unmintedRevertsEverywhere() public {
        vm.expectRevert(abi.encodeWithSelector(CSERenderer.NoRecord.selector, 1));
        renderer.animationURL(1);
        vm.expectRevert(abi.encodeWithSelector(CSERenderer.NoRecord.selector, 1));
        renderer.attributesJSON(1);
        vm.expectRevert();
        cse.tokenURI(1);
    }

    function test_animationURLHasPerTokenHeadAndTheStoredTail() public {
        _mintMany(7);
        string memory a = renderer.animationURL(7);
        assertTrue(_startsWith(a, "data:text/html;base64,"));
        bytes memory head = abi.encodePacked(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>window.CSE={id:7,seed:"',
            Strings.toHexString(uint256(_seed(7)), 32), '"}</script>'
        );
        while (head.length % 3 != 0) head = abi.encodePacked(head, " ");
        assertTrue(_contains(a, Base64.encode(head)));
        // the pre-encoded tail is appended as is, which is the whole point
        bytes memory tail = bytes(TAIL);
        while (tail.length % 3 != 0) tail = abi.encodePacked(tail, " ");
        assertTrue(_contains(a, Base64.encode(tail)));
    }

    function test_tokenURIFallsBackWithoutRenderer() public {
        _mintAs(alice, _seed(1));
        vm.prank(owner);
        cse.setRenderer(address(0));
        assertEq(cse.tokenURI(1), "ipfs://x/1.json");
    }

    // ---- the reveal

    function test_revealerCanRevealOwnerSetsIt() public {
        address watcher = address(0x3A7C);
        _sellOut();
        address table = SSTORE2.write(_traitTable());
        vm.prank(watcher);
        vm.expectRevert(CSERenderer.NotRevealer.selector);
        renderer.reveal(table);

        vm.prank(watcher);
        vm.expectRevert();
        renderer.setRevealer(watcher);
        vm.prank(owner);
        renderer.setRevealer(watcher);
        assertEq(renderer.revealer(), watcher);

        vm.prank(watcher);
        renderer.reveal(table);
        assertTrue(renderer.revealed());
    }

    function test_revealOnlyAfterSellOutAndOnce() public {
        _mintMany(3);
        address table = SSTORE2.write(_traitTable());
        vm.prank(owner);
        vm.expectRevert(CSERenderer.NotSoldOut.selector);
        renderer.reveal(table);
        vm.prank(alice);
        vm.expectRevert();
        renderer.reveal(table);

        _sellOut();
        vm.prank(alice);
        vm.expectRevert();
        renderer.reveal(table);
        vm.prank(owner);
        renderer.reveal(table);
        assertTrue(renderer.revealed());
        vm.prank(owner);
        vm.expectRevert(CSERenderer.AlreadyRevealed.selector);
        renderer.reveal(table);
    }

    function test_recordUnpacksAfterReveal() public {
        _sellOut();
        _reveal();
        CSERenderer.Record memory r = renderer.record(7);
        assertEq(r.structure, 5);
        assertEq(r.rootState, 1);
        assertEq(r.symmetry, 0);
        assertEq(r.discClass, 1);
        assertEq(r.discBand, 2);
        assertEq(r.phase, 2);
        assertEq(r.energy, 0);
        assertEq(r.feedback, 0);
        assertEq(r.palette, 0);
        assertEq(r.rarityRank, 300);
        // an all-zero record is an id the table never wrote
        vm.expectRevert(abi.encodeWithSelector(CSERenderer.NoRecord.selector, 2));
        renderer.record(2);
    }

    function test_attributesMirrorTheGenerator() public {
        _sellOut();
        _reveal();
        assertEq(
            renderer.attributesJSON(1),
            '[{"trait_type":"Structure","value":"Lattice"},{"trait_type":"Root State","value":"3 Real Distinct"},'
            '{"trait_type":"Symmetry","value":"Transposed"},{"trait_type":"Energy","value":"Violent"},{"trait_type":"Feedback","value":"Echo"},'
            '{"trait_type":"Palette","value":"AMBER"},{"trait_type":"Rarity Rank","value":14}]'
        );
        // #7: Fractured shown, Identity dropped, phase ω2 shown, Mid band hides the palette
        assertEq(
            renderer.attributesJSON(7),
            '[{"trait_type":"Structure","value":"Tessellation"},{"trait_type":"Root State","value":"1 Real 2 Complex"},'
            '{"trait_type":"Discriminant Class","value":"Fractured"},{"trait_type":"Phase","value":"\xcf\x892"},'
            '{"trait_type":"Energy","value":"Still"},{"trait_type":"Feedback","value":"None"},{"trait_type":"Rarity Rank","value":300}]'
        );
    }

    // ---- admin

    function test_setRendererOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        cse.setRenderer(address(0));
    }

    function test_imageBaseSettableUntilLocked() public {
        vm.prank(owner);
        renderer.setImageBase("https://elsewhere/");
        assertEq(renderer.imageBase(), "https://elsewhere/");
        vm.prank(owner);
        renderer.lock();
        vm.prank(owner);
        vm.expectRevert(CSERenderer.Locked.selector);
        renderer.setImageBase("https://nope/");
    }

    function test_rendererAdminOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        renderer.setImageBase("x");
        vm.prank(alice);
        vm.expectRevert();
        renderer.lock();
    }
}

/// Gas of a tokenURI call against the real on-chain page, when it exists.
contract CSERendererRealPageTest is Test {
    function test_realPageTokenURIGas() public {
        string memory dir = "../../out/onchain";
        if (!vm.exists(string.concat(dir, "/page-tail.b64"))) return;
        uint256 signerPk = 0x5167;
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory init = abi.encodeCall(
            CubicSymmetryEngine.initialize, (address(this), 0, 0, "ipfs://x/", address(this), 500, vm.addr(signerPk))
        );
        CubicSymmetryEngine cse = CubicSymmetryEngine(address(new ERC1967Proxy(address(impl), init)));
        bytes memory page = bytes(vm.readFile(string.concat(dir, "/page-tail.b64")));
        uint256 n = (page.length + 23_999) / 24_000;
        address[] memory parts = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            uint256 start = i * 24_000;
            uint256 len = page.length - start < 24_000 ? page.length - start : 24_000;
            bytes memory slice = new bytes(len);
            for (uint256 j = 0; j < len; ++j) slice[j] = page[start + j];
            parts[i] = SSTORE2.write(slice);
        }
        CSERenderer r = new CSERenderer(address(cse), parts, "https://covers.test/");
        cse.setMintState(CubicSymmetryEngine.MintState.PUBLIC);
        bytes32 seed = keccak256("gas");
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(signerPk, cse.mintDigest(address(this), seed, deadline));
        cse.mint{value: 0}(seed, deadline, abi.encodePacked(rr, ss, v), new bytes32[](0));
        uint256 g0 = gasleft();
        string memory uri = r.tokenURI(1);
        uint256 used = g0 - gasleft();
        emit log_named_uint("tokenURI gas (real page)", used);
        emit log_named_uint("tokenURI length", bytes(uri).length);
        assertLt(used, 30_000_000);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
