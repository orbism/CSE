// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";

/**
 * A contract wallet holding two valid approvals re-enters `mint` from the
 * ERC721 receiver hook, trying to mint past the public cap into the owner's
 * reserve. The supply count moves before the token exists, so the inner call
 * sees the cap and reverts, taking the outer mint with it.
 */
contract Reenterer is IERC721Receiver {
    CubicSymmetryEngine immutable engine;
    bytes32 seed2;
    uint256 deadline2;
    bytes sig2;
    bool armed;

    constructor(CubicSymmetryEngine e) {
        engine = e;
    }

    function go(bytes32 s1, uint256 d1, bytes calldata g1, bytes32 s2, uint256 d2, bytes calldata g2) external {
        (seed2, deadline2, sig2, armed) = (s2, d2, g2, true);
        engine.mint{value: engine.price()}(s1, d1, g1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            engine.mint{value: engine.price()}(seed2, deadline2, sig2);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

contract ReentrancyTest is Test {
    CubicSymmetryEngine engine;
    address owner = address(0xA11CE);
    uint256 signerPk = 0x5167;
    uint256 constant PRICE = 0.005 ether;

    function setUp() public {
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory init = abi.encodeCall(
            CubicSymmetryEngine.initialize, (owner, PRICE, "ipfs://x/", owner, 500, vm.addr(signerPk))
        );
        engine = CubicSymmetryEngine(address(new ERC1967Proxy(address(impl), init)));
        vm.prank(owner);
        engine.setMintState(CubicSymmetryEngine.MintState.LIVE);
    }

    function _approve(address minter, bytes32 seed) internal view returns (uint256 deadline, bytes memory sig) {
        deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, engine.mintDigest(minter, seed, deadline));
        sig = abi.encodePacked(r, s, v);
    }

    /// Fill the public allocation to one short of its cap with many wallets.
    function fillToCap() internal returns (uint256 cap) {
        cap = engine.MAX_SUPPLY() - engine.RESERVE(); // 501 public
        uint256 n = 0;
        for (uint256 w = 0; n < cap - 1; w++) {
            address buyer = address(uint160(0x1000 + w));
            vm.deal(buyer, 1 ether);
            for (uint256 i = 0; i < 20 && n < cap - 1; i++) {
                bytes32 seed = keccak256(abi.encode(n));
                (uint256 d, bytes memory s) = _approve(buyer, seed);
                vm.prank(buyer);
                engine.mint{value: PRICE}(seed, d, s);
                n++;
            }
        }
        assertEq(engine.totalMinted(), cap - 1);
    }

    function test_reentrantMintCannotEatTheReserve() public {
        uint256 cap = fillToCap(); // 500 minted, 1 public slot left
        Reenterer r = new Reenterer(engine);
        vm.deal(address(r), PRICE * 2);
        bytes32 s1 = keccak256("re-1");
        bytes32 s2 = keccak256("re-2");
        (uint256 d1, bytes memory g1) = _approve(address(r), s1);
        (uint256 d2, bytes memory g2) = _approve(address(r), s2);

        // The inner mint reverts with SupplyExhausted, which bubbles up through
        // _safeMint's receiver check and undoes the outer mint too.
        vm.expectRevert();
        r.go(s1, d1, g1, s2, d2, g2);

        assertEq(engine.totalMinted(), cap - 1);
        bytes32[] memory reserve = new bytes32[](engine.RESERVE());
        for (uint256 i = 0; i < reserve.length; i++) reserve[i] = keccak256(abi.encode("reserve", i));
        vm.prank(owner);
        engine.reserveMint(owner, reserve);
        assertEq(engine.reserveMinted(), engine.RESERVE());
    }

    function test_ownershipTransferIsTwoStep() public {
        address next = address(0xB0B);
        vm.prank(owner);
        engine.transferOwnership(next);
        assertEq(engine.owner(), owner);
        assertEq(engine.pendingOwner(), next);
        vm.prank(next);
        engine.acceptOwnership();
        assertEq(engine.owner(), next);
    }
}
