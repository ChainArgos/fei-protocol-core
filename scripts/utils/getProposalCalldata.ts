import * as dotenv from 'dotenv';
import { constructProposalCalldata } from './constructProposalCalldata';

dotenv.config();

// GOAL:
// 1. When generating calldata for a TC proposal, automatically make the call to the metadata registry
// 2. Have it output as one of the steps in the calldata

/**
 * Take in a hardhat proposal object and output the proposal calldatas
 * See `proposals/utils/getProposalCalldata.js` on how to construct the proposal calldata
 */
async function getProposalCalldata() {
  const proposalName = process.env.DEPLOY_FILE;

  if (!proposalName) {
    throw new Error('DEPLOY_FILE env variable not set');
  }

  console.log(await constructProposalCalldata(proposalName));
}

getProposalCalldata()
  .then(() => process.exit(0))
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
