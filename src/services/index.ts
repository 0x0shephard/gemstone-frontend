import type { IDataService } from './IDataService';
import { mockService } from './mockService';

/**
 * The active data service. Today this is the mock implementation. When real
 * ABIs land, add a wagmi-backed `IDataService` and switch it in here (optionally
 * gated by whether contract addresses are configured) — no page changes needed.
 */
export const dataService: IDataService = mockService;

export type { IDataService, ProfileData, LandingData } from './IDataService';
