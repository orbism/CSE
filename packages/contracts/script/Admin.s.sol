// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";

abstract contract AdminScript is Script {
    function engine() internal view returns (CubicSymmetryEngine) {
        return CubicSymmetryEngine(vm.envAddress("CSE_PROXY"));
    }

    function broadcast() internal returns (uint256 pk) {
        pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
    }
}

/// @notice CSE_MINT_STATE: 0 = CLOSED, 1 = LIVE, 2 = SOLD_OUT
contract SetMintState is AdminScript {
    function run() external {
        uint256 state = vm.envUint("CSE_MINT_STATE");
        broadcast();
        engine().setMintState(CubicSymmetryEngine.MintState(uint8(state)));
        vm.stopBroadcast();
        console.log("mintState ->", state);
    }
}

/// @notice CSE_BASE_URI, e.g. ipfs://bafy.../
contract SetBaseURI is AdminScript {
    function run() external {
        string memory uri = vm.envString("CSE_BASE_URI");
        broadcast();
        engine().setBaseURI(uri);
        vm.stopBroadcast();
        console.log("baseURI ->", uri);
    }
}

/**
 * @notice Make the current base URI permanent. There is no undo.
 *
 * Run this only once the pinned CID is final — after this the metadata can
 * never be repointed, which is the entire point.
 */
contract FreezeMetadata is AdminScript {
    function run() external {
        broadcast();
        engine().freezeMetadata();
        vm.stopBroadcast();
        console.log("metadata frozen at:", engine().tokenURI(1));
    }
}

/// @notice CSE_PRICE_WEI
contract SetPrice is AdminScript {
    function run() external {
        uint256 price = vm.envUint("CSE_PRICE_WEI");
        broadcast();
        engine().setPrice(price);
        vm.stopBroadcast();
        console.log("price ->", price);
    }
}

/**
 * @notice CSE_RESERVE_TO, plus either
 *           CSE_RESERVE_IDS  comma-separated ids, e.g. "1,7,1099"
 *         or
 *           CSE_RESERVE_FROM + CSE_RESERVE_QTY  a contiguous run.
 *
 * Ids are explicit because the mint lets buyers choose theirs; the reserve has
 * to name which pieces it is holding back rather than taking whatever is next.
 */
contract ReserveMint is AdminScript {
    function run() external {
        address to = vm.envAddress("CSE_RESERVE_TO");
        uint256[] memory ids;

        try vm.envUint("CSE_RESERVE_IDS", ",") returns (uint256[] memory parsed) {
            ids = parsed;
        } catch {
            uint256 from = vm.envUint("CSE_RESERVE_FROM");
            uint256 qty = vm.envUint("CSE_RESERVE_QTY");
            ids = new uint256[](qty);
            for (uint256 i = 0; i < qty; ++i) ids[i] = from + i;
        }

        broadcast();
        engine().reserveMint(to, ids);
        vm.stopBroadcast();
        console.log("reserved", ids.length, "to", to);
    }
}

/// @notice CSE_WITHDRAW_TO
contract Withdraw is AdminScript {
    function run() external {
        address payable to = payable(vm.envAddress("CSE_WITHDRAW_TO"));
        broadcast();
        engine().withdraw(to);
        vm.stopBroadcast();
        console.log("withdrawn to", to);
    }
}

/**
 * @notice Deploys a fresh implementation and points the proxy at it.
 *         CSE_PROXY must be the existing proxy address.
 */
contract Upgrade is AdminScript {
    function run() external returns (address newImplementation) {
        broadcast();
        CubicSymmetryEngine impl = new CubicSymmetryEngine();
        engine().upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();
        newImplementation = address(impl);
        console.log("new implementation:", newImplementation);
    }
}
