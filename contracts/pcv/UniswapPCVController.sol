pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./IUniswapPCVController.sol";
import "../refs/UniRef.sol";
import "../external/UniswapV2Library.sol";
import "../utils/Timed.sol";

/// @title a IUniswapPCVController implementation for ETH
/// @author Fei Protocol
contract UniswapPCVController is IUniswapPCVController, UniRef, Timed {
    using Decimal for Decimal.D256;
    using SafeMathCopy for uint256;

    uint256 internal _reweightDuration = 4 hours;

    uint256 internal constant BASIS_POINTS_GRANULARITY = 10000;

    /// @notice returns the linked pcv deposit contract
    IPCVDeposit public override pcvDeposit;

    /// @notice gets the FEI reward incentive for reweighting
    uint256 public override reweightIncentiveAmount;
    Decimal.D256 internal _minDistanceForReweight;

    /// @notice EthUniswapPCVController constructor
    /// @param _core Fei Core for reference
    /// @param _pcvDeposit PCV Deposit to reweight
    /// @param _oracle oracle for reference
    /// @param _incentiveAmount amount of FEI for triggering a reweight
    /// @param _minDistanceForReweightBPs minimum distance from peg to reweight in basis points
    /// @param _pair Uniswap pair contract to reweight
    /// @param _router Uniswap Router
    constructor(
        address _core,
        address _pcvDeposit,
        address _oracle,
        uint256 _incentiveAmount,
        uint256 _minDistanceForReweightBPs,
        address _pair,
        address _router
    ) public UniRef(_core, _pair, _router, _oracle) Timed(_reweightDuration) {
        pcvDeposit = IPCVDeposit(_pcvDeposit);

        reweightIncentiveAmount = _incentiveAmount;
        _minDistanceForReweight = Decimal.ratio(
            _minDistanceForReweightBPs,
            BASIS_POINTS_GRANULARITY
        );

        // start timer
        _initTimed();
    }

    /// @notice reweights the linked PCV Deposit to the peg price. Needs to be reweight eligible
    function reweight() external override whenNotPaused {
        require(
            reweightEligible(),
            "EthUniswapPCVController: Not passed reweight time or not at min distance"
        );
        _reweight();
        _incentivize();

        // reset timer
        _initTimed();
    }

    /// @notice reweights regardless of eligibility
    function forceReweight() external override onlyGuardianOrGovernor {
        _reweight();
    }

    /// @notice sets the target PCV Deposit address
    function setPCVDeposit(address _pcvDeposit) external override onlyGovernor {
        pcvDeposit = IPCVDeposit(_pcvDeposit);
        emit PCVDepositUpdate(_pcvDeposit);
    }

    /// @notice sets the reweight incentive amount
    function setReweightIncentive(uint256 amount)
        external
        override
        onlyGovernor
    {
        reweightIncentiveAmount = amount;
        emit ReweightIncentiveUpdate(amount);
    }

    /// @notice sets the reweight min distance in basis points
    function setReweightMinDistance(uint256 basisPoints)
        external
        override
        onlyGovernor
    {
        _minDistanceForReweight = Decimal.ratio(
            basisPoints,
            BASIS_POINTS_GRANULARITY
        );
        emit ReweightMinDistanceUpdate(basisPoints);
    }

    /// @notice sets the reweight duration
    function setDuration(uint256 _duration)
        external
        override
        onlyGovernor
    {
       _setDuration(_duration);
    }

    /// @notice signal whether the reweight is available. Must have incentive parity and minimum distance from peg
    function reweightEligible() public view override returns (bool) {
        bool magnitude =
            _getDistanceToPeg().greaterThan(_minDistanceForReweight);
        // incentive parity is achieved after a certain time relative to distance from peg
        bool time = isTimeEnded();
        return magnitude && time;
    }

    /// @notice minimum distance as a percentage from the peg for a reweight to be eligible
    function minDistanceForReweight()
        external
        view
        override
        returns (Decimal.D256 memory)
    {
        return _minDistanceForReweight;
    }

    function _incentivize() internal ifMinterSelf {
        fei().mint(msg.sender, reweightIncentiveAmount);
    }

    function _reweight() internal {
        (uint256 feiReserves, uint256 tokenReserves) = getReserves();
        if (feiReserves == 0 || tokenReserves == 0) {
            return;
        }

        Decimal.D256 memory _peg = peg();

        if (_isBelowPeg(_peg)) {
            _rebase(_peg, feiReserves, tokenReserves);
        } else {
            _reverseReweight(_peg, feiReserves, tokenReserves);
        }

        emit Reweight(msg.sender);
    }

    function _rebase(
        Decimal.D256 memory _peg,
        uint256 feiReserves, 
        uint256 tokenReserves
    ) internal {
        // Calculate the ideal amount of FEI in the pool for the reserves of the non-FEI token
        uint256 targetAmount = _peg.mul(tokenReserves).asUint256();

        // burn the excess FEI not needed from the pool
        uint256 burnAmount = feiReserves.sub(targetAmount);
        fei().burnFrom(address(pair), burnAmount);

        // sync the pair to restore the reserves 
        pair.sync();
    }

    function _reverseReweight(        
        Decimal.D256 memory _peg,
        uint256 feiReserves, 
        uint256 tokenReserves
    ) internal {
        // calculate amount FEI needed to return to peg then swap
        uint256 amountIn = _getAmountToPegFei(feiReserves, tokenReserves, _peg);

        IFei _fei = fei();
        _fei.mint(address(pair), amountIn);

        _swap(address(_fei), amountIn, feiReserves, tokenReserves);

        // Redeposit purchased tokens
        _deposit();
    }


    function _swap(
        address tokenIn,
        uint256 amount,
        uint256 reservesIn,
        uint256 reservesOut
    ) internal returns (uint256 amountOut) {

        amountOut = UniswapV2Library.getAmountOut(amount, reservesIn, reservesOut);

        (uint256 amount0Out, uint256 amount1Out) =
            pair.token0() == tokenIn
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
        pair.swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    function _deposit() internal {
        // resupply PCV at peg ratio
        IERC20 erc20 = IERC20(token);
        uint256 balance = erc20.balanceOf(address(this));

        SafeERC20.safeTransfer(erc20, address(pcvDeposit), balance);
        pcvDeposit.deposit(balance);
    }
}
