import { describe, expect, it } from 'vitest';
import {
  assertClientRelease,
  assertDeploymentMatchesEnvironment,
  type ProtocolDeployment,
} from './deployment.ts';

const deployment: ProtocolDeployment = {
  id: 'sepolia-suite-2',
  chain_id: 11155111,
  deployment_block: 12000000,
  dge_nft_address: '0x1111111111111111111111111111111111111111',
  gem_registry_address: '0x2222222222222222222222222222222222222222',
  marketplace_address: '0x3333333333333333333333333333333333333333',
  primary_sale_auction_address: '0x4444444444444444444444444444444444444444',
  redemption_manager_address: '0x5555555555555555555555555555555555555555',
  swap_escrow_address: '0x6666666666666666666666666666666666666666',
  requires_client_release: true,
  status: 'active',
};

const environment = {
  PROTOCOL_DEPLOYMENT_ID: deployment.id,
  CHAIN_ID: String(deployment.chain_id),
  DEPLOYMENT_BLOCK: String(deployment.deployment_block),
  DGE_NFT_ADDRESS: deployment.dge_nft_address,
  GEM_REGISTRY_ADDRESS: deployment.gem_registry_address,
  MARKETPLACE_ADDRESS: deployment.marketplace_address,
  PRIMARY_SALE_AUCTION_ADDRESS: deployment.primary_sale_auction_address,
  REDEMPTION_MANAGER_ADDRESS: deployment.redemption_manager_address,
  SWAP_ESCROW_ADDRESS: deployment.swap_escrow_address,
};

describe('protocol deployment configuration', () => {
  it('accepts one complete, active manifest', () => {
    expect(() => assertDeploymentMatchesEnvironment(deployment, environment)).not.toThrow();
  });

  it('rejects a partial contract cutover', () => {
    expect(() =>
      assertDeploymentMatchesEnvironment(deployment, {
        ...environment,
        DGE_NFT_ADDRESS: '0x7777777777777777777777777777777777777777',
      }),
    ).toThrow('DGE_NFT_ADDRESS does not match');
  });

  it('rejects a staging deployment even when addresses match', () => {
    expect(() =>
      assertDeploymentMatchesEnvironment({ ...deployment, status: 'staging' }, environment),
    ).toThrow('not active');
  });

  it('rejects an old browser release after cutover but permits authenticated server jobs', () => {
    expect(() =>
      assertClientRelease(deployment, {
        headers: new Headers({ 'x-protocol-deployment': 'old-suite' }),
      }),
    ).toThrow('Refresh Digital Carat');
    expect(() => assertClientRelease(deployment)).not.toThrow();
  });

  it('keeps the legacy deployment compatible with the current browser build', () => {
    expect(() =>
      assertClientRelease(
        { ...deployment, requires_client_release: false },
        {
          headers: new Headers(),
        },
      ),
    ).not.toThrow();
  });

  it('rejects the still-live fresh browser bundle during a legacy rollback', () => {
    expect(() =>
      assertClientRelease(
        { ...deployment, id: 'sepolia-11155111-40fe3f22', requires_client_release: false },
        { headers: new Headers({ 'x-protocol-deployment': deployment.id }) },
      ),
    ).toThrow('Refresh Digital Carat');
  });

  it('accepts only the exact fresh release during forward cutover', () => {
    expect(() =>
      assertClientRelease(deployment, {
        headers: new Headers({ 'x-protocol-deployment': deployment.id }),
      }),
    ).not.toThrow();
    expect(() => assertClientRelease(deployment, { headers: new Headers() })).toThrow(
      'Refresh Digital Carat',
    );
  });
});
