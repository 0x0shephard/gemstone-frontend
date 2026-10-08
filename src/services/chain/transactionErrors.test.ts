import { describe, expect, it } from 'vitest';
import { ContractFunctionRevertedError, parseAbi } from 'viem';
import { decodeTransactionError } from './transactionPipeline';

const abi = parseAbi(['function requestRedemption(uint256,bytes32,bytes32)']);

describe('decodeTransactionError', () => {
  it('explains the solvency freeze instead of a bare revert', () => {
    // Insolvent(9999, 10000): the revert live Sepolia returned on 2026-10-08.
    const data =
      '0x1f2c89f0000000000000000000000000000000000000000000000000000000000000270f0000000000000000000000000000000000000000000000000000000000002710';
    const error = decodeTransactionError(
      new ContractFunctionRevertedError({ abi, data, functionName: 'requestRedemption' }),
    );
    expect(error.message).toMatch(/reserves are briefly below full coverage/);
  });
});
