// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SSTORE2} from "./SSTORE2.sol";

interface ICSEToken {
    function seedOf(uint256 tokenId) external view returns (bytes32);
    function totalMinted() external view returns (uint256);
}

/**
 * @title CSERenderer
 * @notice On-chain metadata and the live piece for every Form.
 *
 * `tokenURI` returns a `data:application/json;base64,` document whose
 * `animation_url` is a `data:text/html;base64,` page carrying the whole CSE
 * engine. Nothing is fetched from anywhere: the chain holds the engine (as a
 * gzipped, base64-encoded page tail) and each token's seed. The browser
 * inflates the engine with its native DecompressionStream and derives the Form
 * from the seed alone.
 *
 * Traits arrive at sell-out. Rarity is a property of the whole set, so the
 * attributes (including Rarity Rank) are derived from the minted seeds once
 * the last one is in and written here exactly once, with `reveal`. Anyone can
 * recompute them from the seeds and check.
 *
 * ## The page is assembled, not re-encoded
 *
 * Base64 maps every 3 input bytes to 4 output characters independently, so a
 * stream can be assembled from separately encoded pieces as long as every
 * piece but the last is a whole number of 3-byte groups. The page tail is
 * stored already encoded (padded to that boundary by the generator); the
 * per-token head is encoded here and padded the same way, and the two are
 * simply concatenated. The JSON around them is encoded once per call, which
 * is a view and costs nobody anything.
 *
 * `image` points at the cover stills, which live off-chain by choice: a
 * marketplace-grade raster of every Form costs more gas than the rest of the
 * collection put together. The owner can move them until `lock()`.
 */
contract CSERenderer is Ownable2Step {
    using Strings for uint256;

    error Locked();
    error NoRecord(uint256 tokenId);
    error AlreadyRevealed();
    error NotSoldOut();
    error NotRevealer();

    event ImageBaseChanged(string imageBase);
    event Revealed(address traits);
    event RevealerChanged(address revealer);
    event LockedForever();

    uint256 public constant RECORD = 8;
    uint256 public constant MAX_SUPPLY = 512;

    ICSEToken public immutable token;
    /// @notice The page tail, base64-encoded and padded, in storage order.
    address[] public pageParts;
    /// @notice Packed trait records, RECORD bytes per token, id 1 first. Zero until revealed.
    address public traits;
    /// @notice Prefix of every cover URL: `<imageBase><id>.png`.
    string public imageBase;
    bool public locked;
    /// @notice May call `reveal` besides the owner: the mint watcher's key, so sell-out reveals itself.
    address public revealer;

    constructor(address token_, address[] memory pageParts_, string memory imageBase_) Ownable(msg.sender) {
        token = ICSEToken(token_);
        pageParts = pageParts_;
        imageBase = imageBase_;
    }

    // ------------------------------------------------------------- admin

    function setImageBase(string calldata next) external onlyOwner {
        if (locked) revert Locked();
        imageBase = next;
        emit ImageBaseChanged(next);
    }

    function setRevealer(address next) external onlyOwner {
        revealer = next;
        emit RevealerChanged(next);
    }

    /**
     * @notice Write the trait table, once, after the last token is minted.
     *         Owner or revealer.
     * @param traits_ an SSTORE2 pointer holding MAX_SUPPLY x RECORD bytes
     */
    function reveal(address traits_) external {
        if (msg.sender != owner() && msg.sender != revealer) revert NotRevealer();
        if (traits != address(0)) revert AlreadyRevealed();
        if (token.totalMinted() < MAX_SUPPLY) revert NotSoldOut();
        traits = traits_;
        emit Revealed(traits_);
    }

    /// @notice Freeze the cover location. One way.
    function lock() external onlyOwner {
        locked = true;
        emit LockedForever();
    }

    // --------------------------------------------------------- metadata

    struct Record {
        uint8 structure;
        uint8 rootState;
        uint8 symmetry;
        uint8 discClass;
        uint8 discBand;
        uint8 phase;
        uint8 energy;
        uint8 feedback;
        uint8 palette;
        uint16 rarityRank;
        uint8 nonce;
    }

    function revealed() public view returns (bool) {
        return traits != address(0);
    }

    function record(uint256 tokenId) public view returns (Record memory r) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY || traits == address(0)) revert NoRecord(tokenId);
        bytes memory b = SSTORE2.read(traits, (tokenId - 1) * RECORD, RECORD);
        r.structure = uint8(b[0]);
        r.rootState = uint8(b[1]);
        r.symmetry = uint8(b[2]);
        r.discClass = uint8(b[3]) & 0x03;
        r.discBand = (uint8(b[3]) >> 2) & 0x07;
        r.phase = (uint8(b[3]) >> 5) & 0x03;
        r.energy = uint8(b[4]) & 0x03;
        r.feedback = (uint8(b[4]) >> 2) & 0x03;
        r.palette = (uint8(b[4]) >> 4) & 0x0f;
        r.rarityRank = (uint16(uint8(b[5])) << 8) | uint16(uint8(b[6]));
        r.nonce = uint8(b[7]);
        // an all-zero record is an id the generator never wrote
        if (r.rarityRank == 0) revert NoRecord(tokenId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        bytes32 seed = _seed(tokenId);
        // built in stages: one encodePacked with every piece runs out of stack
        bytes memory json = abi.encodePacked(
            '{"name":"Cubic Symmetry Engine #', _pad4(tokenId), '","description":"', DESCRIPTION
        );
        json = abi.encodePacked(json, '","image":"', imageBase, tokenId.toString(), '.png","seed":"', _hex(seed));
        json = abi.encodePacked(
            json, '","animation_url":"data:text/html;base64,', Base64.encode(_pageHead(tokenId, seed)), _pageTail()
        );
        json = abi.encodePacked(json, '","attributes":', attributesJSON(tokenId), "}");
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    /**
     * @notice The token's attributes as the JSON array `tokenURI` carries.
     *         Before the reveal, the one thing that is known: that it is waiting.
     */
    function attributesJSON(uint256 tokenId) public view returns (string memory) {
        if (traits == address(0)) {
            _seed(tokenId);
            return '[{"trait_type":"Traits","value":"Revealed at sell-out"}]';
        }
        return string(_attributes(record(tokenId)));
    }

    /// @notice The live piece alone, as a data URL, for anything that wants just the page.
    function animationURL(uint256 tokenId) external view returns (string memory) {
        return string.concat("data:text/html;base64,", Base64.encode(_pageHead(tokenId, _seed(tokenId))), _pageTail());
    }

    // --------------------------------------------------------- internals

    function _seed(uint256 tokenId) internal view returns (bytes32 seed) {
        seed = token.seedOf(tokenId);
        if (seed == bytes32(0)) revert NoRecord(tokenId);
    }

    /// @dev The per-token start of the page, padded to a multiple of 3 bytes.
    function _pageHead(uint256 tokenId, bytes32 seed) internal pure returns (bytes memory) {
        bytes memory head = abi.encodePacked(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>window.CSE={id:',
            tokenId.toString(), ',seed:"', _hex(seed), '"}</script>'
        );
        return _padTo3(head);
    }

    function _hex(bytes32 b) internal pure returns (string memory) {
        return Strings.toHexString(uint256(b), 32);
    }

    function _pageTail() internal view returns (string memory out) {
        for (uint256 i = 0; i < pageParts.length; ++i) {
            out = string.concat(out, string(SSTORE2.read(pageParts[i])));
        }
    }

    /// @dev Trailing spaces inside an HTML `<head>` are harmless.
    function _padTo3(bytes memory b) internal pure returns (bytes memory) {
        while (b.length % 3 != 0) b = abi.encodePacked(b, " ");
        return b;
    }

    function _pad4(uint256 n) internal pure returns (string memory s) {
        s = n.toString();
        while (bytes(s).length < 4) s = string.concat("0", s);
    }

    /**
     * @dev Mirrors `attributesOf` in packages/core: the commonest value of an axis
     *      is omitted (Separated, Identity, ω0), Energy and Feedback are always
     *      stated, and Palette is listed when the discriminant band is not Mid.
     */
    function _attributes(Record memory r) internal view returns (bytes memory out) {
        out = abi.encodePacked(
            '[', _attr("Structure", STRUCTURES[r.structure]),
            ',', _attr("Root State", ROOT_STATES[r.rootState])
        );
        if (r.discClass != 0) out = abi.encodePacked(out, ',', _attr("Discriminant Class", DISC_CLASSES[r.discClass]));
        if (r.symmetry != 0) out = abi.encodePacked(out, ',', _attr("Symmetry", SYMMETRIES[r.symmetry]));
        if (r.phase != 0) out = abi.encodePacked(out, ',', _attr("Phase", r.phase == 1 ? unicode"ω1" : unicode"ω2"));
        out = abi.encodePacked(
            out,
            ',', _attr("Energy", ENERGIES[r.energy]),
            ',', _attr("Feedback", FEEDBACKS[r.feedback])
        );
        if (r.discBand != 2) out = abi.encodePacked(out, ',', _attr("Palette", PALETTES[r.palette]));
        out = abi.encodePacked(
            out, ',{"trait_type":"Rarity Rank","value":', uint256(r.rarityRank).toString(), '}]'
        );
    }

    function _attr(string memory t, string memory v) internal pure returns (bytes memory) {
        return abi.encodePacked('{"trait_type":"', t, '","value":"', v, '"}');
    }

    // ----------------------------------------------------- vocabularies
    // Index order is the generator's; see packages/core/src/traits.ts.

    string internal constant DESCRIPTION =
        "One cubic equation, rendered as form. The three roots become the primary bodies, "
        "the discriminant decides whether they separate, fracture or merge, and the cube-root "
        "branch rotates the whole triad by a third of a turn. Everything you see is derived "
        "from the algebra. Nothing is decoration.";

    string[22] internal STRUCTURES = [
        "Grid", "Radial", "Tower", "Knot", "Void", "Tessellation", "Exploded", "Lattice",
        "Spiral", "Shell", "Cascade", "Orbital", "Weave", "Bloom", "Rift", "Strata",
        "Labyrinth", "Fold", "Prism", "Arbor", "Vessel", "Aperture"
    ];
    string[4] internal ROOT_STATES = ["3 Real Distinct", "1 Real 2 Complex", "Double Root", "Triple Root"];
    string[3] internal DISC_CLASSES = ["Separated", "Fractured", "Merged"];
    string[5] internal SYMMETRIES = ["Identity", unicode"Cyclic ω", unicode"Cyclic ω²", "Transposed", unicode"Full S₃"];
    string[3] internal ENERGIES = ["Still", "Charged", "Violent"];
    string[4] internal FEEDBACKS = ["None", "Echo", "Resonant", "Runaway"];
    string[9] internal PALETTES = [
        "PHOSPHOR", "AMBER", "VT-CYAN", "MAGENTA-BURN", "IRON", "OXBLOOD", "ULTRAVIOLET", "BONE", "SIGNAL"
    ];
}
