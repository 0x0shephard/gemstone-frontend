import type { IDataService } from './IDataService';
import { mockService } from './mockService';
import { env } from '@/config/env';
import { deploymentManifest, deploymentErrors } from '@/config/contracts';

const blockedChainService = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error(`Chain mode is blocked:\n${deploymentErrors.join('\n')}`);
    },
  },
) as IDataService;

let chainServicePromise: Promise<IDataService> | undefined;
const lazyChainService = new Proxy(
  {},
  {
    get:
      (_target, property: keyof IDataService) =>
      async (...args: unknown[]) => {
        chainServicePromise ??= import('./chain/chainService').then(
          (module) => module.chainService,
        );
        const service = await chainServicePromise;
        const method = service[property] as (...methodArgs: unknown[]) => unknown;
        return method(...args);
      },
  },
) as IDataService;

export const dataService: IDataService =
  env.dataMode === 'mock'
    ? mockService
    : deploymentManifest
      ? lazyChainService
      : blockedChainService;

export type { IDataService, ProfileData, LandingData } from './IDataService';

/**
 * The token minted for a DGE number, read from GemRegistry. Loaded on demand
 * with the rest of the chain service; only the admin screens need it.
 */
export async function tokenIdForGem(gemId: bigint): Promise<bigint> {
  if (env.dataMode === 'mock') throw new Error('DGE lookups need chain mode.');
  if (!deploymentManifest)
    throw new Error(`Chain mode is blocked:\n${deploymentErrors.join('\n')}`);
  const module = await import('./chain/chainService');
  return module.tokenIdForGem(gemId);
}
