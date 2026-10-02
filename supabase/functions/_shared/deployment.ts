import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ProtocolDeployment {
  id: string;
  chain_id: number | string;
  deployment_block: number | string;
  dge_nft_address: string;
  gem_registry_address: string;
  marketplace_address: string;
  primary_sale_auction_address: string;
  redemption_manager_address: string;
  swap_escrow_address: string;
  requires_client_release: boolean;
  status: 'staging' | 'active' | 'archived';
}

type DeploymentEnvironment = Record<string, string | undefined>;

const ADDRESS = /^0x[0-9a-f]{40}$/i;

const addressFields = [
  ['dge_nft_address', 'DGE_NFT_ADDRESS'],
  ['gem_registry_address', 'GEM_REGISTRY_ADDRESS'],
  ['marketplace_address', 'MARKETPLACE_ADDRESS'],
  ['primary_sale_auction_address', 'PRIMARY_SALE_AUCTION_ADDRESS'],
  ['redemption_manager_address', 'REDEMPTION_MANAGER_ADDRESS'],
  ['swap_escrow_address', 'SWAP_ESCROW_ADDRESS'],
] as const;

function required(environment: DeploymentEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/**
 * Fail closed when the database scope and the contracts configured on an Edge
 * isolate are not the same verified suite.
 *
 * This is deliberately stricter than checking only the NFT address: a partial
 * secret update could otherwise read gems from one registry and submit a gift
 * or redemption against another deployment.
 */
export function assertDeploymentMatchesEnvironment(
  deployment: ProtocolDeployment,
  environment: DeploymentEnvironment,
): void {
  const configuredId = required(environment, 'PROTOCOL_DEPLOYMENT_ID');
  if (deployment.id !== configuredId) {
    throw new Error('Protocol deployment configuration does not match the active database scope');
  }
  if (deployment.status !== 'active') {
    throw new Error('Protocol deployment is not active');
  }

  const chainId = required(environment, 'CHAIN_ID');
  const deploymentBlock = required(environment, 'DEPLOYMENT_BLOCK');
  if (String(deployment.chain_id) !== chainId) {
    throw new Error('CHAIN_ID does not match the active protocol deployment');
  }
  if (String(deployment.deployment_block) !== deploymentBlock) {
    throw new Error('DEPLOYMENT_BLOCK does not match the active protocol deployment');
  }

  for (const [field, secret] of addressFields) {
    const configured = required(environment, secret);
    if (!ADDRESS.test(configured)) throw new Error(`${secret} is invalid`);
    if (deployment[field].toLowerCase() !== configured.toLowerCase()) {
      throw new Error(`${secret} does not match the active protocol deployment`);
    }
  }
}

function edgeEnvironment(): DeploymentEnvironment {
  return {
    PROTOCOL_DEPLOYMENT_ID: Deno.env.get('PROTOCOL_DEPLOYMENT_ID'),
    CHAIN_ID: Deno.env.get('CHAIN_ID'),
    DEPLOYMENT_BLOCK: Deno.env.get('DEPLOYMENT_BLOCK'),
    DGE_NFT_ADDRESS: Deno.env.get('DGE_NFT_ADDRESS'),
    GEM_REGISTRY_ADDRESS: Deno.env.get('GEM_REGISTRY_ADDRESS'),
    MARKETPLACE_ADDRESS: Deno.env.get('MARKETPLACE_ADDRESS'),
    PRIMARY_SALE_AUCTION_ADDRESS: Deno.env.get('PRIMARY_SALE_AUCTION_ADDRESS'),
    REDEMPTION_MANAGER_ADDRESS: Deno.env.get('REDEMPTION_MANAGER_ADDRESS'),
    SWAP_ESCROW_ADDRESS: Deno.env.get('SWAP_ESCROW_ADDRESS'),
  };
}

export function protocolDeploymentId(): string {
  const deploymentId = Deno.env.get('PROTOCOL_DEPLOYMENT_ID')?.trim();
  if (!deploymentId) throw new Error('PROTOCOL_DEPLOYMENT_ID is not configured');
  return deploymentId;
}

export function assertClientRelease(
  deployment: ProtocolDeployment,
  request?: Pick<Request, 'headers'>,
): void {
  // Scheduled functions authenticate with their own server-only secret and do
  // not originate in a browser build, so no Request means no client release
  // handshake. User-facing endpoints always pass their Request.
  if (!request) return;
  const supplied = request.headers.get('x-protocol-deployment')?.trim();
  // The legacy bundle predates the header, so only that one deployment accepts
  // an absent value. A non-empty header is always an explicit release claim and
  // must match — especially during rollback, when the still-live fresh bundle
  // must fail closed against legacy Edge secrets/contracts.
  if (supplied === deployment.id || (!supplied && !deployment.requires_client_release)) return;
  throw new Error('Refresh Digital Carat before using the current protocol deployment');
}

/** Resolve and verify the deployment scope once at the start of an Edge request. */
export async function requireProtocolDeployment(
  admin: SupabaseClient,
  request?: Request,
): Promise<ProtocolDeployment> {
  const deploymentId = protocolDeploymentId();
  const { data, error } = await admin
    .from('protocol_deployments')
    .select(
      'id,chain_id,deployment_block,dge_nft_address,gem_registry_address,marketplace_address,primary_sale_auction_address,redemption_manager_address,swap_escrow_address,requires_client_release,status',
    )
    .eq('id', deploymentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Configured protocol deployment is not registered');
  const deployment = data as ProtocolDeployment;
  assertDeploymentMatchesEnvironment(deployment, edgeEnvironment());
  assertClientRelease(deployment, request);
  return deployment;
}
