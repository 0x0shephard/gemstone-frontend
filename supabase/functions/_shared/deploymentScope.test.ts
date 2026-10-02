import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relative: string) =>
  readFileSync(join(process.cwd(), 'supabase/functions', relative, 'index.ts'), 'utf8');

describe('Edge protocol deployment isolation', () => {
  it.each([
    'v1-seller-submit',
    'v1-seller-commitment',
    'v1-seller-activate',
    'v1-custody-confirm',
    'v1-verification-queue',
    'v1-verification-grade',
    'v1-redemption-commitment',
    'v1-redemption-fulfillment',
    'v1-gift-create',
    'v1-gift-claim',
    'v1-gift-cancel',
    'v1-gift-notify',
    'v1-demand-refresh',
    'v1-auction-refresh',
    'v1-notify-sweep',
  ])('%s validates the complete active manifest before workflow access', (functionName) => {
    const definition = source(functionName);
    expect(definition).toContain('requireProtocolDeployment');
    expect(definition).toMatch(/await requireProtocolDeployment\(admin(?:, request)?\)/);
  });

  it.each([
    'v1-seller-submit',
    'v1-seller-commitment',
    'v1-seller-activate',
    'v1-custody-confirm',
    'v1-verification-queue',
    'v1-verification-grade',
    'v1-redemption-commitment',
    'v1-redemption-fulfillment',
    'v1-gift-create',
    'v1-gift-claim',
    'v1-gift-cancel',
    'v1-gift-notify',
  ])('%s binds mutations to the browser release header', (functionName) => {
    expect(source(functionName)).toContain('await requireProtocolDeployment(admin, request)');
  });

  it('scopes every shared chain projection by the configured deployment', () => {
    const demand = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/demand.ts'),
      'utf8',
    );
    const notifications = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/notify.ts'),
      'utf8',
    );
    const seller = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/sellerAutomation.ts'),
      'utf8',
    );
    expect(demand).toContain(".eq('deployment_id', protocolDeploymentId())");
    expect(demand).toContain("onConflict: 'deployment_id,tx_hash,log_index'");
    expect(notifications).toContain('deployment_id: protocolDeploymentId()');
    expect(notifications).toContain(".eq('deployment_id', protocolDeploymentId())");
    expect(seller).toContain(".eq('deployment_id', protocolDeploymentId())");
  });

  it('writes new seller, redemption and gift records with an explicit deployment id', () => {
    expect(source('v1-seller-submit')).toContain('deployment_id: deployment.id');
    expect(source('v1-redemption-commitment')).toContain('deployment_id: deployment.id');
    expect(source('v1-gift-create')).toContain('deployment_id: deployment.id');
  });
});
