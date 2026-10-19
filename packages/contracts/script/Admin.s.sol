// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CubicSymmetryEngine} from "../src/CubicSymmetryEngine.sol";
import {CSERenderer} from "../src/CSERenderer.sol";

abstract contract AdminScript is Script {
    function engine() internal view returns (CubicSymmetryEngine) {
        return CubicSymmetryEngine(vm.envAddress("CSE_PROXY"));
    }

    function broadcast() internal returns (uint256 pk) {
        pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
    }
}

/// @notice CSE_MINT_STATE: 0 = CLOSED, 1 = ALLOWLIST, 2 = PUBLIC (3 = SOLD_OUT happens by itself)
contract SetMintState is AdminScript {
    function run() external {
        uint256 state = vm.envUint("CSE_MINT_STATE");
        broadcast();
        engine().setMintState(CubicSymmetryEngine.MintState(uint8(state)));
        vm.stopBroadcast();
        console.log("mintState ->", state);
    }
}

/// @notice CSE_ALLOWLIST_ROOT: the raffle's Merkle root (apps/web `pnpm draw`)
contract SetAllowlistRoot is AdminScript {
    function run() external {
        bytes32 root = vm.envBytes32("CSE_ALLOWLIST_ROOT");
        broadcast();
        engine().setAllowlistRoot(root);
        vm.stopBroadcast();
        console.log("allowlistRoot set");
    }
}

/// @notice CSE_ALLOWLIST_PRICE_WEI
contract SetAllowlistPrice is AdminScript {
    function run() external {
        uint256 p = vm.envUint("CSE_ALLOWLIST_PRICE_WEI");
        broadcast();
        engine().setAllowlistPrice(p);
        vm.stopBroadcast();
        console.log("allowlistPrice ->", p);
    }
}

/// @notice CSE_RENDERER, CSE_REVEALER: who besides the owner may trigger the reveal
contract SetRevealer is AdminScript {
    function run() external {
        address next = vm.envAddress("CSE_REVEALER");
        broadcast();
        CSERenderer(vm.envAddress("CSE_RENDERER")).setRevealer(next);
        vm.stopBroadcast();
        console.log("revealer ->", next);
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

/// @notice CSE_SIGNER: rotate the approver key.
contract SetSigner is AdminScript {
    function run() external {
        address next = vm.envAddress("CSE_SIGNER");
        broadcast();
        engine().setSigner(next);
        vm.stopBroadcast();
        console.log("signer ->", next);
    }
}

/// @notice CSE_RENDERER: the on-chain renderer, or 0x0 to fall back to the base URI.
contract SetRenderer is AdminScript {
    function run() external {
        address renderer = vm.envAddress("CSE_RENDERER");
        broadcast();
        engine().setRenderer(renderer);
        vm.stopBroadcast();
        console.log("renderer ->", renderer);
    }
}

/// @notice CSE_RENDERER + CSE_IMAGE_BASE: where the cover stills live, <base><id>.png
contract SetImageBase is AdminScript {
    function run() external {
        string memory base = vm.envString("CSE_IMAGE_BASE");
        broadcast();
        CSERenderer(vm.envAddress("CSE_RENDERER")).setImageBase(base);
        vm.stopBroadcast();
        console.log("imageBase ->", base);
    }
}

/// @notice CSE_RENDERER: freeze the cover location. There is no undo.
contract LockRenderer is AdminScript {
    function run() external {
        broadcast();
        CSERenderer(vm.envAddress("CSE_RENDERER")).lock();
        vm.stopBroadcast();
        console.log("renderer locked");
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

/// @notice CSE_RESERVE_TO and CSE_RESERVE_SEEDS: comma-separated 32-byte seeds, no approval needed.
contract ReserveMint is AdminScript {
    function run() external {
        address to = vm.envAddress("CSE_RESERVE_TO");
        bytes32[] memory seeds = vm.envBytes32("CSE_RESERVE_SEEDS", ",");
        broadcast();
        engine().reserveMint(to, seeds);
        vm.stopBroadcast();
        console.log("reserved", seeds.length, "to", to);
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
