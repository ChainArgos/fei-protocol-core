import {  ZERO_ADDRESS, expectEvent, expectRevert, getAddresses, getCore } from '../../helpers';
import { expect } from 'chai'
import hre, { ethers, artifacts } from 'hardhat';

const toBN = ethers.BigNumber.from
const Fei = artifacts.readArtifactSync('Fei');
const MockIncentive = artifacts.readArtifactSync('MockUniswapIncentive');
const MockIncentivized = artifacts.readArtifactSync('MockIncentivized');

describe('Fei', function () {
  let userAddress;
  let governorAddress;
  let minterAddress;
  let burnerAddress;

  before(async() => {
    const addresses = await getAddresses()

    // add any addresses you want to impersonate here
    const impersonatedAddresses = [
      addresses.userAddress,
      addresses.pcvControllerAddress,
      addresses.governorAddress,
      addresses.minterAddress
    ]

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [address]
      })

      impersonatedSigners[address] = await ethers.getSigner(address)
    }
  });

  beforeEach(async function () {
    ({
      minterAddress,
      burnerAddress,
      governorAddress,
      userAddress
    } = await getAddresses());
    this.core = await getCore();
    this.fei = await Fei.at(await this.core.fei());
  });

  describe('mint', function () {
    describe('Paused', function() {
      it('reverts', async function() {
        await this.fei.connect(impersonatedSigners[governorAddress]).pause();
        await expectRevert(this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 100), 'Pausable: paused');
      });
    });
    describe('not from minter', function () {
      it('reverts', async function () {
        await expectRevert(this.fei.mint(userAddress, 100), 'CoreRef: Caller is not a minter');
      });
    });

    describe('from minter', function () {
      beforeEach(async function () {
        expectEvent(
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 100),
          'Minting',
          {
            _to: userAddress,
            _minter: minterAddress,
            _amount: '100'
          }
        );
      });

      it('mints new Fei tokens', async function () {
        expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(100));
      });
    });
  });

  describe('burn', function () {
    describe('Paused', function() {
      it('reverts', async function() {
        await this.fei.pause({from: governorAddress});
        await expectRevert(this.fei.connect(impersonatedSigners[burnerAddress]).burnFrom(userAddress, 100), 'Pausable: paused');
      });
    });
    describe('not from burner', function () {
      it('reverts', async function () {
        await expectRevert(this.fei.burnFrom(userAddress, 100), 'CoreRef: Caller is not a burner');
      });
    });

    describe('from burner to user with sufficient balance', function () {
      beforeEach(async function () {
        await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 200);
        expectEvent(
          await this.fei.connect(impersonatedSigners[burnerAddress]).burnFrom(userAddress, 100),
          'Burning',
          {
            _to: userAddress,
            _burner: burnerAddress,
            _amount: '100'
          }
        );
      });

      it('burn Fei tokens', async function () {
        expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(100));
      });
    });
    describe('from burner to user without sufficient balance', function () {
      it('burn Fei tokens', async function () {
        await expectRevert(this.fei.connect(impersonatedSigners[burnerAddress]).burnFrom(userAddress, 100), 'ERC20: burn amount exceeds balance');
      });
    });
  });

  describe('incentive contracts', function () {
    beforeEach(async function () {
      this.incentive = await MockIncentive.new(this.core.address);
      this.incentivizedContract = await MockIncentivized.new(this.core.address);
      this.incentivizedAddress = this.incentivizedContract.address;
      await this.core.grantMinter(this.incentive.address, {from: governorAddress});
      expectEvent(
        await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.incentivizedAddress, this.incentive.address),
        'IncentiveContractUpdate',
        {
          _incentivized: this.incentivizedAddress,
          _incentiveContract: this.incentive.address
        }
      );
    });

    it('incentive contract registered', async function () {
      expect(await this.fei.incentiveContract(this.incentivizedAddress)).to.be.equal(this.incentive.address);
    });

    describe('via transfer', function () {
      describe('on sender', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(this.incentivizedAddress, 200);
          const { logs } = await this.incentivizedContract.sendFei(userAddress, 200);
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(100));
        });
      });
      describe('on receiver', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 200);
          const { logs } = await this.fei.connect(impersonatedSigners[userAddress]).transfer(this.incentivizedAddress, 200);
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(100));
        });
      });
      describe('on all', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 200);
          // Set all incentive
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(ZERO_ADDRESS, this.incentive.address);
          // unset incentive
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.incentivizedAddress, ZERO_ADDRESS);

          const { logs } = await this.fei.connect(impersonatedSigners[userAddress]).transfer(this.incentivizedAddress, 200);
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(100));
        });
      });
      describe('on sender and receiver', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(this.incentivizedAddress, 200);
          const { logs } = await this.incentivizedContract.sendFei(this.incentivizedAddress, 200);
          this.logs = logs;
        });

        it('balances update with incentives', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(400)); // infinite FEI ;)
        });
      });
      describe('on receiver and all', function () {
        beforeEach(async function () {
          await this.fei.mint(userAddress, 200, { from: minterAddress });
          // Set incentive on zero address
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(ZERO_ADDRESS, this.incentive.address);

          const { logs } = await this.fei.connect(impersonatedSigners[userAddress]).transfer(this.incentivizedAddress, 200);
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(200));
        });
      });
    });
    describe('via transferFrom', function () {
      beforeEach(async function() {
        this.operator = await MockIncentivized.new(this.core.address);
        this.operatorAddress = this.operator.address;
      });

      describe('on operator', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 200);
          await this.fei.connect(impersonatedSigners[userAddress]).approve(this.operatorAddress, 200);
          // Set incentive on operator
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.operatorAddress, this.incentive.address);
          // Unset incentive on this.incentivizedAddress
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.incentivizedAddress, ZERO_ADDRESS);

          const { logs } = await this.operator.sendFeiFrom(userAddress, this.incentivizedAddress, 200);
          
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(100));
        });

        it('operator approval decrements', async function () {
          expect(await this.fei.allowance(userAddress, this.operatorAddress)).to.be.equal(toBN(0));
        });
      });
      describe('on sender and operator', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(this.incentivizedAddress, 200);
          this.incentivizedContract.approve(this.operatorAddress);
          // Set incentive on operator
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.operatorAddress, this.incentive.address);

          const { logs } = await this.operator.sendFeiFrom(this.incentivizedAddress, userAddress, 200);

          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });
      });

      describe('on operator and all', function () {
        beforeEach(async function () {
          await this.fei.connect(impersonatedSigners[minterAddress]).mint(userAddress, 200);
          await this.fei.connect(impersonatedSigners[userAddress]).approve(this.operatorAddress, 200);
          // Set incentive on operator
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.operatorAddress, this.incentive.address);
          // Unset incentive on this.incentivizedAddress
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(this.incentivizedAddress, ZERO_ADDRESS);
          // Set incentive on all 
          await this.fei.connect(impersonatedSigners[governorAddress]).setIncentiveContract(ZERO_ADDRESS, this.incentive.address);

          const { logs } = await this.operator.sendFeiFrom(userAddress, this.incentivizedAddress, 200);
          this.logs = logs;
        });

        it('balances update', async function () {
          expect(await this.fei.balanceOf(this.incentivizedAddress)).to.be.equal(toBN(200));
        });

        it('incentive applied', async function () {
          expect(await this.fei.balanceOf(userAddress)).to.be.equal(toBN(200));
        });

        it('operator approval decrements', async function () {
          expect(await this.fei.allowance(userAddress, this.operatorAddress)).to.be.equal(toBN(0));
        });
      });
    });
  });
});
