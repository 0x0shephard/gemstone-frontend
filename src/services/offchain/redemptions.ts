import type { Hash } from 'viem';
import { requireClient } from './invoke';

export type RedemptionWorkflowStatus =
  'draft' | 'committed' | 'onchain_requested' | 'cancelled' | 'fulfilled';

export interface RedemptionWorkflow {
  workflowId: string;
  tokenId: string;
  method: 'pickup' | 'insured_delivery';
  status: RedemptionWorkflowStatus;
  requestHash: Hash | null;
  transactionHash: Hash | null;
  createdAt: string;
}

export interface RedemptionFulfillmentForm {
  pickupLocation: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export function redemptionFulfillmentDetails(
  method: RedemptionWorkflow['method'],
  form: RedemptionFulfillmentForm,
): Record<string, string> {
  if (method === 'pickup') return { pickupLocation: form.pickupLocation.trim() };
  return Object.fromEntries(
    Object.entries({
      recipientName: form.recipientName,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      city: form.city,
      region: form.region,
      postalCode: form.postalCode,
      country: form.country,
    })
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0),
  );
}

export function redemptionFulfillmentIsValid(
  method: RedemptionWorkflow['method'],
  form: RedemptionFulfillmentForm,
): boolean {
  const details = redemptionFulfillmentDetails(method, form);
  return method === 'pickup'
    ? Boolean(details.pickupLocation)
    : ['recipientName', 'addressLine1', 'city', 'postalCode', 'country'].every((key) =>
        Boolean(details[key]),
      );
}

interface RedemptionWorkflowRow {
  id: string;
  token_id: string | number;
  fulfillment_method: RedemptionWorkflow['method'];
  status: RedemptionWorkflowStatus;
  request_hash: Hash | null;
  transaction_hash: Hash | null;
  created_at: string;
}

const selection = 'id,token_id,fulfillment_method,status,request_hash,transaction_hash,created_at';

function fromRow(row: RedemptionWorkflowRow): RedemptionWorkflow {
  return {
    workflowId: row.id,
    tokenId: String(row.token_id),
    method: row.fulfillment_method,
    status: row.status,
    requestHash: row.request_hash,
    transactionHash: row.transaction_hash,
    createdAt: row.created_at,
  };
}

/** The signed-in owner's recent receipts, including records recovered after reload. */
export async function listRedemptionWorkflows(): Promise<RedemptionWorkflow[]> {
  const { data, error } = await requireClient()
    .from('redemption_requests')
    .select(selection)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RedemptionWorkflowRow[]).map(fromRow);
}

/** Re-read the workflow before presenting it as durably recorded. */
export async function getRedemptionWorkflow(
  workflowId: string,
): Promise<RedemptionWorkflow | null> {
  const { data, error } = await requireClient()
    .from('redemption_requests')
    .select(selection)
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as unknown as RedemptionWorkflowRow) : null;
}
