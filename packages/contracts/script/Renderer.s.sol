// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {CSERenderer} from "../src/CSERenderer.sol";
import {SSTORE2} from "../src/SSTORE2.sol";

// Puts the engine and the trait table on chain and deploys the renderer that
// serves them. `DeployRenderer` runs standalone to replace the renderer later
// (the token's `setRenderer` is the switch); `Deploy` reuses `deployRenderer`
// on a fresh deployment.
//
// env:
//   PRIVATE_KEY       owner key
//   CSE_PROXY         the token
//   CSE_ONCHAIN_DIR   holds page-tail.b64, from `pnpm --filter @cse/generator onchain`
//                     (traits arrive at sell-out: see Reveal.s.sol)
//   CSE_IMAGE_BASE    prefix of the cover URLs: <base><id>.png
//
// foundry.toml grants read access to out/onchain for the file reads below.

abstract contract RendererBase is Script {
    /// @dev Under the EIP-170 limit with room for the STOP byte.
    uint256 internal constant CHUNK = 24_000;

    /// @dev Caller holds the broadcast. Returns the renderer; does not wire it.
    function deployRenderer(address token, string memory dir, string memory imageBase)
        internal
        returns (address)
    {
        bytes memory page = bytes(vm.readFile(string.concat(dir, "/page-tail.b64")));
        require(page.length % 4 == 0, "page tail is not whole base64 groups");
        return address(new CSERenderer(token, _store(page), imageBase));
    }

    /// @dev The page tail across as many code chunks as it needs, in order.
    function _store(bytes memory page) internal returns (address[] memory parts) {
        uint256 n = (page.length + CHUNK - 1) / CHUNK;
        parts = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            uint256 start = i * CHUNK;
            parts[i] = SSTORE2.write(_slice(page, start, page.length - start < CHUNK ? page.length - start : CHUNK));
            console.log("page part", i, parts[i]);
        }
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 j = 0; j < len; ++j) out[j] = b[start + j];
    }
}

contract DeployRenderer is RendererBase {
    function run() external returns (address renderer) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("CSE_PROXY");
        vm.startBroadcast(pk);
        renderer = deployRenderer(proxy, vm.envString("CSE_ONCHAIN_DIR"), vm.envString("CSE_IMAGE_BASE"));
        CubicSymmetryEngine(proxy).setRenderer(renderer);
        vm.stopBroadcast();
        console.log("renderer       :", renderer);
    }
}
