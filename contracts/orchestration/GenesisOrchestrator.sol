pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../pool/FeiPool.sol";
import "../genesis/GenesisGroup.sol";

contract GenesisOrchestrator is Ownable {

	function init(
		address core, 
		address ethBondingCurve, 
		address ido, 
		address tribeFeiPair,
		address oracle,
		uint genesisDuration,
		uint exhangeRateDiscount,
		uint poolDuration
	) public onlyOwner returns (address genesisGroup, address pool) {
		pool = address(new FeiPool(core, tribeFeiPair, poolDuration));
		genesisGroup = address(new GenesisGroup(
			core, 
			ethBondingCurve, 
			ido,
			oracle,
			pool, 
			genesisDuration, 
			exhangeRateDiscount
		));
		return (genesisGroup, pool);
	}

	function detonate() public onlyOwner {
		selfdestruct(payable(owner()));
	}
}