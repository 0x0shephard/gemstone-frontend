-- Stage the Arbitrum One suite deployed at block 519342582
-- (gemstone-contracts deployments/arbitrum-one-519342582.json). This migration does not make
-- it active; Edge secrets/functions and the browser release must be ready first.
-- The final switch is one transaction through activate_protocol_deployment.

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
  'arbitrum-one-519342582',
  42161,
  519342582,
  lower('0x603687aBbc6504Bc6EA8836fA44cFBaE92b42D4E'),
  lower('0x195f80cB544Ab5FDEE5F92C318F92F004C0aF08c'),
  lower('0x3E6F3856A5eFAa3492A1819221dC17c276dE5A27'),
  lower('0xdC7440e02e1dD5bD64FcBe36eA2f4f67A6d56cA3'),
  lower('0xdfdeb2d812b3d9a3Baa48213067AdcCb2B9dc520'),
  lower('0x161bb576eE61df8389ED1769cBb8A24aE7525D19'),
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
