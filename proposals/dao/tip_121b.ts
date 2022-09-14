import {
  Fei,
  MerkleRedeemerDripper,
  MerkleRedeemerDripper__factory,
  RariMerkleRedeemer
} from '@custom-types/contracts';
import { RariMerkleRedeemer__factory } from '@custom-types/contracts/factories/RariMerkleRedeemer__factory';
import {
  DeployUpgradeFunc,
  NamedAddresses,
  SetupUpgradeFunc,
  TeardownUpgradeFunc,
  ValidateUpgradeFunc
} from '@custom-types/types';
import { Contract } from '@ethersproject/contracts';
import { cTokens } from '@proposals/data/hack_repayment/cTokens';
import { rates } from '@proposals/data/hack_repayment/rates';
import { roots } from '@proposals/data/hack_repayment/roots';
import { MainnetContractsConfig } from '@protocol/mainnetAddresses';
import { getImpersonatedSigner } from '@test/helpers';
import { forceEth } from '@test/integration/setup/utils';
import { expect } from 'chai';
import { parseEther } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

/*

DAO Proposal Part 2

Description: Enable and mint FEI into the MerkleRedeeemrDripper contract, allowing those that are specified 
in the snapshot [insert link] and previous announcement to redeem an amount of cTokens for FEI.

Steps:
  1 - Mint FEI to the RariMerkleRedeemer contract
*/

const fipNumber = 'tip_121b';

const dripPeriod = 3600; // 1 hour
const dripAmount = ethers.utils.parseEther('2500000'); // 2.5m Fei

const rariMerkleRedeemerInitialBalance = ethers.utils.parseEther('5000000'); // 5m Fei
const merkleRedeemerDripperInitialBalance = ethers.utils.parseEther('45000000'); // 45m Fei

// Do any deployments
// This should exclusively include new contract deployments
const deploy: DeployUpgradeFunc = async (deployAddress: string, addresses: NamedAddresses, logging: boolean) => {
  const rariMerkleRedeemerFactory = new RariMerkleRedeemer__factory((await ethers.getSigners())[0]);
  const rariMerkleRedeemer = await rariMerkleRedeemerFactory.deploy(
    MainnetContractsConfig.fei.address, // token: fei
    cTokens, // ctokens (address[])
    rates, // rates (uint256[])
    roots // roots (bytes32[])
  );

  const merkleRedeeemrDripperFactory = new MerkleRedeemerDripper__factory((await ethers.getSigners())[0]);
  const merkleRedeemerDripper = await merkleRedeeemrDripperFactory.deploy(
    addresses.core,
    rariMerkleRedeemer.address,
    dripPeriod,
    dripAmount,
    addresses.fei
  );

  return {
    rariMerkleRedeemer,
    merkleRedeemerDripper
  };
};

// Do any setup necessary for running the test.
// This could include setting up Hardhat to impersonate accounts,
// ensuring contracts have a specific state, etc.
const setup: SetupUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  console.log(`Setup actions for fip${fipNumber}`);
  await logDaiBalances(contracts.dai);
};

// Tears down any changes made in setup() that need to be
// cleaned up before doing any validation checks.
const teardown: TeardownUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  console.log(`No actions to complete in teardown for fip${fipNumber}`);
};

// Run any validations required on the fip using mocha or console logging
// IE check balances, check state of contracts, etc.
const validate: ValidateUpgradeFunc = async (addresses, oldContracts, contracts, logging) => {
  const rariMerkleRedeemer = contracts.rariMerkleRedeemer as RariMerkleRedeemer;
  const merkleRedeemerDripper = contracts.merkleRedeemerDripper as MerkleRedeemerDripper;

  // validate that all 27 ctokens exist & are set
  for (let i = 0; i < cTokens.length; i++) {
    expect(await rariMerkleRedeemer.merkleRoots(cTokens[i])).to.be.equal(roots[i]);
    expect(await rariMerkleRedeemer.cTokenExchangeRates(cTokens[i])).to.be.equal(rates[i]);
  }

  //console.log(`Sending ETH to both contracts...`);

  // send eth to both contracts so that we can impersonate them later
  await forceEth(rariMerkleRedeemer.address, parseEther('1').toString());
  await forceEth(merkleRedeemerDripper.address, parseEther('1').toString());

  // check initial balances of dripper & redeemer
  // ensure that initial balance of the dripper is a multiple of drip amount
  const fei = contracts.fei as Fei;
  expect(await fei.balanceOf(rariMerkleRedeemer.address)).to.be.equal(rariMerkleRedeemerInitialBalance);
  expect(await fei.balanceOf(merkleRedeemerDripper.address)).to.be.equal(merkleRedeemerDripperInitialBalance);
  expect((await fei.balanceOf(merkleRedeemerDripper.address)).mod(dripAmount)).to.be.equal(0);

  //console.log('Advancing time 1 hour...');

  // advance time > 1 hour to drip again
  await ethers.provider.send('evm_increaseTime', [dripPeriod + 1]);

  // expect a drip to fail because the redeemer has enough tokens already
  await expect(merkleRedeemerDripper.drip()).to.be.revertedWith(
    'MerkleRedeemerDripper: dripper target already has enough tokens.'
  );

  // impersonate the redeemer and send away its tokens so that we can drip again
  const redeemerSigner = await getImpersonatedSigner(rariMerkleRedeemer.address);
  const redeemerFeiBalance = await (contracts.fei as Fei).balanceOf(rariMerkleRedeemer.address);
  await (contracts.fei as Fei).connect(redeemerSigner).transfer(addresses.timelock, redeemerFeiBalance);
  expect(await (contracts.fei as Fei).balanceOf(rariMerkleRedeemer.address)).to.be.equal(0);

  //console.log('Doing final drip test...');

  // finally, call drip again to make sure it works
  const redeemerBalBeforeDrip = await fei.balanceOf(rariMerkleRedeemer.address);
  await merkleRedeemerDripper.drip();
  const redeemerBalAfterDrip = await fei.balanceOf(rariMerkleRedeemer.address);
  expect(redeemerBalAfterDrip.sub(redeemerBalBeforeDrip)).to.be.equal(dripAmount);

  await logDaiBalances(contracts.dai);

  // Execute fuseWithdrawalGuard actions
  let i = 0;
  while (await contracts.fuseWithdrawalGuard.check()) {
    const protecActions = await contracts.fuseWithdrawalGuard.getProtecActions();
    const depositAddress = '0x' + protecActions.datas[0].slice(34, 74);
    const depositLabel = getAddressLabel(addresses, depositAddress);
    const withdrawAmountHex = '0x' + protecActions.datas[0].slice(138, 202);
    const withdrawAmountNum = Number(withdrawAmountHex) / 1e18;
    console.log('fuseWithdrawalGuard   protec action #', ++i, depositLabel, 'withdraw', withdrawAmountNum);
    await contracts.pcvSentinel.protec(contracts.fuseWithdrawalGuard.address);
  }
};

const BABYLON_ADDRESS = '0x97FcC2Ae862D03143b393e9fA73A32b563d57A6e';
const FRAX_ADDRESS = '0xB1748C79709f4Ba2Dd82834B8c82D4a505003f27';
const OLYMPUS_ADDRESS = '0x245cc372C84B3645Bf0Ffe6538620B04a217988B';
const VESPER_ADDRESS = '0x9520b477Aa81180E6DdC006Fc09Fb6d3eb4e807A';
const RARI_DAI_AGGREGATOR_ADDRESS = '0xafd2aade64e6ea690173f6de59fc09f5c9190d74';
const GNOSIS_SAFE_ADDRESS = '0x7189b2ea41d406c5044865685fedb615626f9afd';
const FUJI_CONTRACT_ADDRESS = '0x1868cBADc11D3f4A12eAaf4Ab668e8aA9a76d790';
const CONTRACT_1_ADDRESS = '0x07197a25bf7297c2c41dd09a79160d05b6232bcf';
const ALOE_ADDRESS_1 = '0x0b76abb170519c292da41404fdc30bb5bef308fc';
const ALOE_ADDRESS_2 = '0x8bc7c34009965ccb8c0c2eb3d4db5a231ecc856c';
const CONTRACT_2_ADDRESS = '0x5495f41144ecef9233f15ac3e4283f5f653fc96c';
const BALANCER_ADDRESS = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
const CONTRACT_3_ADDRESS = '0xeef86c2e49e11345f1a693675df9a38f7d880c8f';
const CONTRACT_4_ADDRESS = '0xa10fca31a2cb432c9ac976779dc947cfdb003ef0';
// TODO
const RARI_FOR_ARBITRUM_ADDRESS = '0xa731585ab05fC9f83555cf9Bff8F58ee94e18F85';

async function logDaiBalances(dai: Contract) {
  console.log('Babylon DAI balance: ', Number(await dai.balanceOf(BABYLON_ADDRESS)) / 1e18);
  console.log('Frax DAI balance: ', Number(await dai.balanceOf(FRAX_ADDRESS)) / 1e18);
  console.log('Olympus DAI balance: ', Number(await dai.balanceOf(OLYMPUS_ADDRESS)) / 1e18);
  console.log('Vesper DAI balance: ', Number(await dai.balanceOf(VESPER_ADDRESS)) / 1e18);
  console.log('Rari DAI balance: ', Number(await dai.balanceOf(RARI_DAI_AGGREGATOR_ADDRESS)) / 1e18);
  console.log('Gnosis DAI balance: ', Number(await dai.balanceOf(GNOSIS_SAFE_ADDRESS)) / 1e18);
  console.log('Fuji DAI balance: ', Number(await dai.balanceOf(FUJI_CONTRACT_ADDRESS)) / 1e18);
  console.log('Contract 1 DAI balance: ', Number(await dai.balanceOf(CONTRACT_1_ADDRESS)) / 1e18);
  console.log('Contract 2 DAI balance: ', Number(await dai.balanceOf(CONTRACT_2_ADDRESS)) / 1e18);
  console.log('Contract 3 DAI balance: ', Number(await dai.balanceOf(CONTRACT_3_ADDRESS)) / 1e18);
  console.log('Contract 4 DAI balance: ', Number(await dai.balanceOf(CONTRACT_4_ADDRESS)) / 1e18);
  console.log('Aloe 1 DAI balance: ', Number(await dai.balanceOf(ALOE_ADDRESS_1)) / 1e18);
  console.log('Aloe 2 DAI balance: ', Number(await dai.balanceOf(ALOE_ADDRESS_2)) / 1e18);
  console.log('Balancer DAI balance: ', Number(await dai.balanceOf(BALANCER_ADDRESS)) / 1e18);
  console.log('Rari for Arbitrum DAI balance: ', Number(await dai.balanceOf(RARI_FOR_ARBITRUM_ADDRESS)) / 1e18);
}

function getAddressLabel(addresses: NamedAddresses, address: string) {
  for (const key in addresses) {
    if (address.toLowerCase() == addresses[key].toLowerCase()) return key;
  }
  return '???';
}

export { deploy, setup, teardown, validate };
