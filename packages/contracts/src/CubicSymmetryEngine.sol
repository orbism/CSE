// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface ICSERenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/**
 * @title Cubic Symmetry Engine
 * @notice 512 tokens, each visualising the algebraic structure of one cubic
 *         equation. A Form is a pure function of a 32-byte seed; the seed is
 *         rolled on the site, checked against every Form already minted, and
 *         written here at mint. `renderer` serves the metadata and the live
 *         piece from the chain itself (see CSERenderer), with `baseURI` as the
 *         off-chain fallback until one is set.
 *
 * ## How a mint stays unique and un-snipeable
 *
 * Nothing on chain can tell two Forms apart, so the check runs before the
 * transaction: the site's approver derives the candidate, compares it against
 * everything minted (the maths directly, the rendered fingerprint via the mint
 * watcher's index) and, if it is clear, signs `Mint(minter, seed, deadline)`.
 * This contract mints only a seed whose signature names `msg.sender`, so a
 * roll seen in the mempool is worthless to anyone else, and a seed can be
 * minted exactly once. Token ids are sequential.
 *
 * Upgradeable via UUPS so the renderer, royalty policy or mint mechanics can be
 * corrected without migrating holders to a new address.
 */
contract CubicSymmetryEngine is
    Initializable,
    ERC721Upgradeable,
    ERC2981Upgradeable,
    Ownable2StepUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using Strings for uint256;

    // --------------------------------------------------------------- constants

    uint256 public constant MAX_SUPPLY = 512;
    /// @notice Held back for the artist; minted by the owner, not the public sale.
    uint256 public constant RESERVE = 11;
    uint256 public constant MAX_PER_WALLET = 20;
    bytes32 public constant MINT_TYPEHASH = keccak256("Mint(address minter,bytes32 seed,uint256 deadline)");

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

    /// @notice The address whose signature approves a seed for a minter.
    address public signer;
    /// @notice The seed each token was minted from. Immutable once written.
    mapping(uint256 => bytes32) public seedOf;
    /// @notice Which token holds a seed; zero means unminted.
    mapping(bytes32 => uint256) public tokenOfSeed;

    /// @notice Once true, `setBaseURI` and `setRenderer` revert forever.
    bool public metadataFrozen;

    /**
     * @notice Serves `tokenURI` when set: the on-chain metadata and engine.
     *         Zero means fall back to `baseURI` + id + ".json".
     */
    address public renderer;

    /// @dev Reserved so future upgrades can add storage without collisions.
    uint256[40] private __gap;

    // ------------------------------------------------------------------ events

    event Minted(uint256 indexed tokenId, bytes32 indexed seed, address indexed to);
    event MintStateChanged(MintState previous, MintState current);
    event PriceChanged(uint256 previous, uint256 current);
    event SignerChanged(address signer);
    event BaseURIChanged(string baseURI);
    event Withdrawn(address indexed to, uint256 amount);
    event MetadataFrozen(string baseURI, address renderer);
    event RendererChanged(address renderer);

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
    error SeedTaken(bytes32 seed);
    error ApprovalExpired();
    error BadSignature();
    error MetadataAlreadyFrozen();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 price_,
        string memory baseURI_,
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        address signer_
    ) external initializer {
        if (owner_ == address(0) || royaltyReceiver_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        __ERC721_init("Cubic Symmetry Engine", "CSE");
        __ERC2981_init();
        // Two-step: a transfer only completes when the new owner accepts, so a
        // typo in the address cannot strand the contract without an admin.
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __EIP712_init("Cubic Symmetry Engine", "1");

        price = price_;
        _baseTokenURI = baseURI_;
        signer = signer_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);
    }

    // ------------------------------------------------------------------- mint

    /**
     * @notice Mint the Form rolled from `seed`, with the approver's signature
     *         over (msg.sender, seed, deadline). One token per call.
     */
    function mint(bytes32 seed, uint256 deadline, bytes calldata signature) external payable {
        if (mintState != MintState.LIVE) revert MintNotLive();
        if (block.timestamp > deadline) revert ApprovalExpired();
        // the reserve is carved out of the cap so the owner can always claim it
        if (totalMinted + 1 > MAX_SUPPLY - (RESERVE - reserveMinted)) revert SupplyExhausted();
        if (mintedBy[msg.sender] + 1 > MAX_PER_WALLET) revert WalletLimitExceeded();
        if (msg.value != price) revert IncorrectPayment();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(MINT_TYPEHASH, msg.sender, seed, deadline)));
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert BadSignature();

        mintedBy[msg.sender] += 1;
        _mintSeed(msg.sender, seed);
    }

    /// @notice Owner-only claim against the held-back reserve, no approval needed.
    function reserveMint(address to, bytes32[] calldata seeds) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 quantity = seeds.length;
        if (quantity == 0) revert InvalidQuantity();
        if (reserveMinted + quantity > RESERVE) revert ReserveExhausted();
        if (totalMinted + quantity > MAX_SUPPLY) revert SupplyExhausted();

        reserveMinted += quantity;
        for (uint256 i = 0; i < quantity; ++i) _mintSeed(to, seeds[i]);
    }

    /**
     * @dev Sequential ids. The count moves before the token exists: `_safeMint`
     *      calls out to a contract recipient, which may re-enter `mint`, and
     *      every check above must see the updated supply when it does.
     */
    function _mintSeed(address to, bytes32 seed) private {
        if (seed == bytes32(0) || tokenOfSeed[seed] != 0) revert SeedTaken(seed);
        uint256 id = ++totalMinted;
        seedOf[id] = seed;
        tokenOfSeed[seed] = id;
        if (totalMinted == MAX_SUPPLY && mintState != MintState.SOLD_OUT) {
            emit MintStateChanged(mintState, MintState.SOLD_OUT);
            mintState = MintState.SOLD_OUT;
        }
        emit Minted(id, seed, to);
        _safeMint(to, id);
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

    /// @notice Rotate the approver. Signatures from the old key stop working at once.
    function setSigner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        signer = next;
        emit SignerChanged(next);
    }

    function setBaseURI(string calldata next) external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        _baseTokenURI = next;
        emit BaseURIChanged(next);
    }

    /// @notice Point `tokenURI` at an on-chain renderer, or back at `baseURI` with zero.
    function setRenderer(address next) external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        renderer = next;
        emit RendererChanged(next);
    }

    /**
     * @notice Make the current metadata source permanent. One way, on purpose.
     *         Call it once the renderer (or the pinned CID) is final.
     */
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(_baseTokenURI, renderer);
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

    /// @notice The EIP-712 digest a minter's approval signs; exposed so approvers can be tested against the chain.
    function mintDigest(address minter, bytes32 seed, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(MINT_TYPEHASH, minter, seed, deadline)));
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (renderer != address(0)) return ICSERenderer(renderer).tokenURI(tokenId);
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
