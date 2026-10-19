// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CSERenderer} from "../src/CSERenderer.sol";
import {SSTORE2} from "../src/SSTORE2.sol";

// The sell-out reveal: puts the trait table on chain and hands it to the
// renderer, once. The generator's `reveal` command derives it from the minted
// seeds and writes CSE_ONCHAIN_DIR/traits.bin.
//
// env: PRIVATE_KEY, CSE_RENDERER, CSE_ONCHAIN_DIR
contract Reveal is Script {
    function run() external returns (address traits) {
        bytes memory table = vm.readFileBinary(string.concat(vm.envString("CSE_ONCHAIN_DIR"), "/traits.bin"));
        require(table.length == 512 * 8, "traits.bin is not 512 x 8 bytes");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        traits = SSTORE2.write(table);
        CSERenderer(vm.envAddress("CSE_RENDERER")).reveal(traits);
        vm.stopBroadcast();
        console.log("traits         :", traits);
    }
}
