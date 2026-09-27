// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";

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
 *   CSE_PROVENANCE     keccak of the id -> seed table, from provenance.json
 *   CSE_MASTER_SEED    the seed the collection was generated with
 *
 * The last two are set once here and have no setter, so a real deployment that
 * omits them can never acquire them later. `pnpm deploy` refuses to continue on
 * a live network without them; the defaults exist for throwaway local runs.
 */
contract Deploy is Script {
    function run() external returns (address proxy, address implementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("CSE_OWNER", deployer);
        uint256 price = vm.envOr("CSE_PRICE_WEI", uint256(0.005 ether));
        string memory baseURI = vm.envOr("CSE_BASE_URI", string("http://127.0.0.1:8788/metadata/"));
        address royalty = vm.envOr("CSE_ROYALTY", owner);
        uint256 royaltyBps = vm.envOr("CSE_ROYALTY_BPS", uint256(500));
        bytes32 provenance = vm.envOr("CSE_PROVENANCE", bytes32(0));
        string memory masterSeed = vm.envOr("CSE_MASTER_SEED", string("CUBIC-SYMMETRY-ENGINE"));

        vm.startBroadcast(pk);

        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        bytes memory init = abi.encodeCall(
            CubicSymmetryEngine.initialize,
            (owner, price, baseURI, royalty, uint96(royaltyBps), provenance, masterSeed)
        );
        ERC1967Proxy p = new ERC1967Proxy(address(impl), init);

        vm.stopBroadcast();

        proxy = address(p);
        implementation = address(impl);

        console.log("implementation :", implementation);
        console.log("proxy          :", proxy);
        console.log("owner          :", owner);
        console.log("price (wei)    :", price);
        console.log("baseURI        :", baseURI);
    }
}
