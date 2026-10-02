-- Stage the independently verified fresh Sepolia suite. This migration does not
-- make it active; Edge secrets/functions and the browser release must be ready
-- first. The final switch is one transaction through activate_protocol_deployment.

insert into public.protocol_deployments (
  id,
  chain_id,
  deployment_block,
  dge_nft_address,
  gem_registry_address,
  marketplace_address,
  primary_sale_auction_address,
  redemption_manager_address,
  swap_escrow_address,
  requires_client_release,
  status
) values (
  'sepolia-fresh-11828947',
  11155111,
  11828947,
  lower('0x591bB1da8b80C773211301f7fa6f639617182a0d'),
  lower('0x2C4F20f1288Ed0a313C84acb7580da8C53420233'),
  lower('0x4410987B2679bF46AcF75f69372177E882582694'),
  lower('0x7C6a7deCDB433B3B47A4BB73C59E0Cd089e6F1A3'),
  lower('0xD3343fC37621c610C0a601594586656B3199006E'),
  lower('0x8eba95fc2f3eEB4854f8CA751A11dF5FE645F7af'),
  true,
  'staging'
)
on conflict (id) do update
set chain_id = excluded.chain_id,
    deployment_block = excluded.deployment_block,
    dge_nft_address = excluded.dge_nft_address,
    gem_registry_address = excluded.gem_registry_address,
    marketplace_address = excluded.marketplace_address,
    primary_sale_auction_address = excluded.primary_sale_auction_address,
    redemption_manager_address = excluded.redemption_manager_address,
    swap_escrow_address = excluded.swap_escrow_address,
    requires_client_release = excluded.requires_client_release
where public.protocol_deployments.status = 'staging';
