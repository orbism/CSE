// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {RendererBase} from "./Renderer.s.sol";

/**
 * Deploys the implementation and its ERC1967 proxy, then initialises through
 * the proxy in the same transaction so the implementation can never be left
 * initialisable by anyone else.
 *
 * env:
 *   PRIVATE_KEY        deployer key
 *   CSE_OWNER          contract owner (defaults to the deployer)
 *   CSE_PRICE_WEI      mint price          (default 0.005 ether)
 *   CSE_BASE_URI       metadata base URI   (default a localhost placeholder)
 *   CSE_ROYALTY        royalty receiver    (defaults to the owner)
 *   CSE_ROYALTY_BPS    royalty numerator   (default 500 = 5%)
 *   CSE_SIGNER         the approver whose signatures authorise mints (defaults to the owner)
 *   CSE_ONCHAIN_DIR    optional; with CSE_IMAGE_BASE, also deploys the on-chain
 *                      renderer (engine + metadata) and wires it in
 *
 */
contract Deploy is RendererBase {
    function run() external returns (address proxy, address implementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("CSE_OWNER", deployer);
        uint256 price = vm.envOr("CSE_PRICE_WEI", uint256(0.005 ether));
        string memory baseURI = vm.envOr("CSE_BASE_URI", string("http://127.0.0.1:8788/metadata/"));
        address royalty = vm.envOr("CSE_ROYALTY", owner);
        uint256 royaltyBps = vm.envOr("CSE_ROYALTY_BPS", uint256(500));
        address signer = vm.envOr("CSE_SIGNER", owner);

        vm.startBroadcast(pk);

        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory init = abi.encodeCall(
            CubicSymmetryEngine.initialize,
            (owner, price, baseURI, royalty, uint96(royaltyBps), signer)
        );
        ERC1967Proxy p = new ERC1967Proxy(address(impl), init);

        proxy = address(p);
        implementation = address(impl);

        _maybeRenderer(proxy);
        vm.stopBroadcast();

        console.log("implementation :", implementation);
        console.log("proxy          :", proxy);
        console.log("owner          :", owner);
        console.log("price (wei)    :", price);
        console.log("baseURI        :", baseURI);
        console.log("signer         :", signer);
    }

    /// @dev With CSE_ONCHAIN_DIR set, puts the engine on chain and wires the renderer in.
    function _maybeRenderer(address proxy) internal {
        string memory dir = vm.envOr("CSE_ONCHAIN_DIR", string(""));
        if (bytes(dir).length == 0) return;
        address renderer = deployRenderer(proxy, dir, vm.envString("CSE_IMAGE_BASE"));
        CubicSymmetryEngine(proxy).setRenderer(renderer);
        console.log("renderer       :", renderer);
    }
}
