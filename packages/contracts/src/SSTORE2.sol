// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SSTORE2
 * @notice Bytes stored as contract code, the cheapest durable storage on the EVM:
 *         ~200 gas per byte to write, and a single EXTCODECOPY to read any slice.
 *
 * The data is prefixed with a STOP byte so the "contract" can never execute,
 * and the init code just returns it. Each pointer holds at most 24,575 bytes
 * (the EIP-170 code limit, less the STOP).
 */
library SSTORE2 {
    error DataTooLarge();
    error WriteFailed();

    uint256 internal constant MAX = 24_575;

    function write(bytes memory data) internal returns (address pointer) {
        if (data.length > MAX) revert DataTooLarge();
        // runtime: 00 ++ data. init: PUSH2 len, DUP1, PUSH1 0x0a, RETURNDATASIZE,
        // CODECOPY, RETURNDATASIZE, RETURN — copies the runtime (which starts at
        // offset 10) to memory and returns it.
        bytes memory code = abi.encodePacked(
            hex"61", uint16(data.length + 1), hex"80600a3d393df3", hex"00", data
        );
        assembly {
            pointer := create(0, add(code, 32), mload(code))
        }
        if (pointer == address(0)) revert WriteFailed();
    }

    function read(address pointer) internal view returns (bytes memory data) {
        uint256 size = pointer.code.length;
        if (size == 0) return data;
        data = new bytes(size - 1);
        assembly {
            extcodecopy(pointer, add(data, 32), 1, sub(size, 1))
        }
    }

    /// @dev `len` bytes starting at `start` of the stored data (STOP excluded).
    function read(address pointer, uint256 start, uint256 len) internal view returns (bytes memory data) {
        data = new bytes(len);
        assembly {
            extcodecopy(pointer, add(data, 32), add(start, 1), len)
        }
    }
}
