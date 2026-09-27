// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title Cubic Symmetry Engine
 * @notice 512 tokens, each visualising the algebraic structure of one cubic
 *         equation. Deliberately minimal: the art, the metadata and the
 *         uniqueness guarantees all live off-chain and are fixed before the
 *         mint opens. This contract only needs to sell and own them.
 *
 * Upgradeable via UUPS so the base URI scheme, royalty policy or mint mechanics
 * can be corrected without migrating holders to a new address.
 *
 * ## What makes a Form unique, and where that is enforced
 *
 * A Form is a pure function of `(masterSeed, tokenId, nonce)`. Minting takes
 * token ids and nothing else — there is no way to submit coefficients, a seed or
 * any other description of the art — so two tokens can no more share a Form than
 * they can share an id, and ERC-721 already guarantees the latter. That is the
 * whole of the duplication argument, and it needs no per-token state here.
 *
 * What it does *not* give you is a way to check that the art you were shown is
 * the art the token is bound to, because the nonce and the seed live off-chain.
 * `provenanceHash` and `masterSeed` close that: both are set once at
 * initialisation, have no setter, and let anyone recompute the entire id -> art
 * mapping and confirm it is the one that was committed to before the mint
 * opened. `freezeMetadata` then makes the pointer to it permanent.
 */
contract CubicSymmetryEngine is
    Initializable,
    ERC721Upgradeable,
    ERC2981Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using Strings for uint256;

    // --------------------------------------------------------------- constants

    uint256 public constant MAX_SUPPLY = 512;
    /// @notice Held back for the artist; minted by the owner, not the public sale.
    uint256 public constant RESERVE = 11;
    uint256 public constant MAX_PER_WALLET = 20;

    enum MintState {
        CLOSED,
        LIVE,
        SOLD_OUT
    }

    // ----------------------------------------------------------------- storage

    MintState public mintState;
    uint256 public price;
    uint256 public totalMinted;
    uint256 public reserveMinted;
    string private _baseTokenURI;
    mapping(address => uint256) public mintedBy;

    /**
     * @notice keccak256 of the canonical id -> seed table, committed before the
     *         mint opened. Set once at initialisation; there is no setter.
     *
     * The table is `"<id>:<seed>"` for every id in 1..MAX_SUPPLY, ascending,
     * joined with "\n" and with no trailing newline. `provenance.json` in the
     * published collection carries both the hash and that description, so the
     * value here can be recomputed from the art alone.
     */
    bytes32 public provenanceHash;

    /**
     * @notice The seed every Form is derived from. Set once at initialisation.
     *
     * Already public in each token's metadata and animation URL; holding it here
     * as well means the derivation can be reproduced from the chain rather than
     * from a file the project happens to still be hosting.
     */
    string public masterSeed;

    /// @notice Once true, `setBaseURI` reverts forever.
    bool public metadataFrozen;

    /// @dev Reserved so future upgrades can add storage without collisions.
    uint256[41] private __gap;

    // ------------------------------------------------------------------ events

    event MintStateChanged(MintState previous, MintState current);
    event PriceChanged(uint256 previous, uint256 current);
    event BaseURIChanged(string baseURI);
    event Withdrawn(address indexed to, uint256 amount);
    event MetadataFrozen(string baseURI);

    // ------------------------------------------------------------------ errors

    error MintNotLive();
    error SupplyExhausted();
    error WalletLimitExceeded();
    error IncorrectPayment();
    error InvalidQuantity();
    error ReserveExhausted();
    error NothingToWithdraw();
    error WithdrawFailed();
    error ZeroAddress();
    error InvalidTokenId();
    error AlreadyMinted(uint256 tokenId);
    error MetadataAlreadyFrozen();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param provenanceHash_ keccak256 of the canonical id -> seed table. Pass
     *        bytes32(0) only for throwaway local deploys; a real deployment
     *        without it can never add one later, by design.
     * @param masterSeed_ the seed the collection was generated with.
     */
    function initialize(
        address owner_,
        uint256 price_,
        string memory baseURI_,
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        bytes32 provenanceHash_,
        string memory masterSeed_
    ) external initializer {
        if (owner_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        __ERC721_init("Cubic Symmetry Engine", "CSE");
        __ERC2981_init();
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();

        price = price_;
        _baseTokenURI = baseURI_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);

        // Written here and nowhere else. The point of the commitment is that it
        // cannot be revised after people have seen what they were buying.
        provenanceHash = provenanceHash_;
        masterSeed = masterSeed_;
    }

    // ------------------------------------------------------------------- mint

    /**
     * @notice Mint specific tokens by id.
     *
     * Ids are chosen by the buyer rather than handed out in sequence, so the
     * piece on screen is the piece that arrives. The collection is generated,
     * uniqueness-checked and pinned before the mint opens, so every id already
     * has settled art and metadata — picking one takes nothing away from that.
     *
     * Two people can want the same id. The loser's transaction reverts with
     * `AlreadyMinted` rather than silently substituting a different piece.
     */
    function mint(uint256[] calldata tokenIds) external payable {
        if (mintState != MintState.LIVE) revert MintNotLive();
        uint256 quantity = tokenIds.length;
        if (quantity == 0) revert InvalidQuantity();
        // the reserve is carved out of the cap so the owner can always claim it
        if (totalMinted + quantity > MAX_SUPPLY - (RESERVE - reserveMinted)) {
            revert SupplyExhausted();
        }
        if (mintedBy[msg.sender] + quantity > MAX_PER_WALLET) revert WalletLimitExceeded();
        if (msg.value != price * quantity) revert IncorrectPayment();

        mintedBy[msg.sender] += quantity;
        _mintChosen(msg.sender, tokenIds);
    }

    /// @notice Owner-only claim against the held-back reserve, also by id.
    function reserveMint(address to, uint256[] calldata tokenIds) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 quantity = tokenIds.length;
        if (quantity == 0) revert InvalidQuantity();
        if (reserveMinted + quantity > RESERVE) revert ReserveExhausted();
        if (totalMinted + quantity > MAX_SUPPLY) revert SupplyExhausted();

        reserveMinted += quantity;
        _mintChosen(to, tokenIds);
    }

    function _mintChosen(address to, uint256[] calldata tokenIds) private {
        uint256 quantity = tokenIds.length;
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 id = tokenIds[i];
            if (id == 0 || id > MAX_SUPPLY) revert InvalidTokenId();
            // catches both an id someone else already took and a duplicate
            // inside this very call, since the first _safeMint lands first
            if (_ownerOf(id) != address(0)) revert AlreadyMinted(id);
            _safeMint(to, id);
        }
        totalMinted += quantity;
        if (totalMinted == MAX_SUPPLY && mintState != MintState.SOLD_OUT) {
            emit MintStateChanged(mintState, MintState.SOLD_OUT);
            mintState = MintState.SOLD_OUT;
        }
    }

    /**
     * @notice Which ids are taken, as a bitmap.
     *
     * The site has to grey out minted pieces across the whole supply. One call
     * returning 1,111 bits packed into ~18 words is the difference between that
     * being free and being 1,111 RPC round-trips.
     */
    function mintedBitmap() external view returns (uint256[] memory bits) {
        bits = new uint256[]((MAX_SUPPLY + 255) / 256);
        for (uint256 id = 1; id <= MAX_SUPPLY; ++id) {
            if (_ownerOf(id) != address(0)) {
                bits[(id - 1) >> 8] |= 1 << ((id - 1) & 0xff);
            }
        }
    }

    /// @notice Whether a single id is still available.
    function isAvailable(uint256 tokenId) external view returns (bool) {
        return tokenId != 0 && tokenId <= MAX_SUPPLY && _ownerOf(tokenId) == address(0);
    }

    // -------------------------------------------------------------- admin

    function setMintState(MintState next) external onlyOwner {
        emit MintStateChanged(mintState, next);
        mintState = next;
    }

    /// @dev Adjustable without an upgrade; the mint is a single public phase.
    function setPrice(uint256 next) external onlyOwner {
        emit PriceChanged(price, next);
        price = next;
    }

    function setBaseURI(string calldata next) external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        _baseTokenURI = next;
        emit BaseURIChanged(next);
    }

    /**
     * @notice Make the current base URI permanent. One way, on purpose.
     *
     * Until this is called the owner can repoint every token's metadata at any
     * time, which makes `provenanceHash` a promise rather than a guarantee.
     * Call it once the pinned CID is final.
     */
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(_baseTokenURI);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    // -------------------------------------------------------------- views

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice Tokens still available to the public, excluding the unclaimed reserve.
    function remainingPublic() external view returns (uint256) {
        uint256 cap = MAX_SUPPLY - (RESERVE - reserveMinted);
        return cap > totalMinted ? cap - totalMinted : 0;
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
