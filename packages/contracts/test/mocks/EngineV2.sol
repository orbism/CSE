// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CubicSymmetryEngine} from "../../src/CubicSymmetryEngine.sol";

/**
 * Upgrade target used only by the tests. It appends behaviour without touching
 * the inherited storage layout, which is exactly what the upgrade test needs to
 * prove: every pre-upgrade slot still reads correctly through the proxy.
 */
contract EngineV2 is CubicSymmetryEngine {
    function version() external pure returns (string memory) {
        return "v2";
    }
}
