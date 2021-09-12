pragma solidity ^0.8.0;

import "../token/FeiTimedMinter.sol";
import "../oracle/ICollateralizationOracleWrapper.sol";

/// @title CollateralizationOracleKeeper
/// @notice a FEI timed minter which only rewards when updating the collateralization oracle 
contract CollateralizationOracleKeeper is FeiTimedMinter {

    ICollateralizationOracleWrapper public collateralizationOracleWrapper;

    /**
        @notice constructor for CollateralizationOracleKeeper
        @param _core the Core address to reference
        @param _incentive the incentive amount for calling mint paid in FEI
    */
    constructor(
        address _core,
        uint256 _incentive,
        ICollateralizationOracleWrapper _collateralizationOracleWrapper
    ) 
        FeiTimedMinter(_core, address(this), _incentive, MIN_MINT_FREQUENCY, 0) 
    {
        collateralizationOracleWrapper = _collateralizationOracleWrapper;
    }

    /// @notice triggers a minting of FEI
    /// @dev timed and incentivized
    function mint() public override {
        collateralizationOracleWrapper.updateIfOutdated();
        super.mint();
    }
}