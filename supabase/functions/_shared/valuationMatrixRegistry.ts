import { canonicalize } from './canonicalJson.ts';
import { keccak256, toBytes, type Hash } from 'npm:viem@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  VALUATION_MATRIX,
  type CaratAnchor,
  type ValuationMatrix,
  type VarietySpec,
} from './valuationMatrix.ts';

type JsonRecord = Record<string, unknown>;

export function matrixDocument(matrix: ValuationMatrix): JsonRecord {
  return JSON.parse(
    JSON.stringify(matrix, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  ) as JsonRecord;
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function integer(value: unknown, label: string, { allowZero = false } = {}): bigint {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error(`${label} must be an integer`);
  const parsed = BigInt(raw);
  if (allowZero ? parsed < 0n : parsed <= 0n) throw new Error(`${label} must be positive`);
  return parsed;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} cannot be empty`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`).toLowerCase());
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

function integerMap(value: unknown, label: string): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(object(value, label)).map(([key, entry]) => [
      text(key, `${label} key`).toLowerCase(),
      integer(entry, `${label}.${key}`),
    ]),
  );
}

/** Strictly converts a JSON matrix proposal into the integer pricing model. */
export function parseMatrixDocument(value: unknown): ValuationMatrix {
  const source = object(value, 'matrix');
  const varieties = Object.fromEntries(
    Object.entries(object(source.varieties, 'varieties')).map(([name, candidate]) => {
      const spec = object(candidate, `varieties.${name}`);
      return [
        text(name, 'variety').toLowerCase(),
        {
          basePricePerCaratUsd: integer(spec.basePricePerCaratUsd, `${name}.basePricePerCaratUsd`),
          colors: stringList(spec.colors, `${name}.colors`),
          colorGrades: stringList(spec.colorGrades, `${name}.colorGrades`),
        } satisfies VarietySpec,
      ];
    }),
  );
  if (Object.keys(varieties).length === 0) throw new Error('At least one variety is required');

  if (!Array.isArray(source.caratAnchors) || source.caratAnchors.length < 2) {
    throw new Error('At least two carat anchors are required');
  }
  const caratAnchors = source.caratAnchors.map((candidate, index) => {
    const anchor = object(candidate, `caratAnchors[${index}]`);
    return {
      microCarats: integer(anchor.microCarats, `caratAnchors[${index}].microCarats`),
      multiplierPpm: integer(anchor.multiplierPpm, `caratAnchors[${index}].multiplierPpm`),
    } satisfies CaratAnchor;
  });
  for (let index = 1; index < caratAnchors.length; index += 1) {
    if (caratAnchors[index].microCarats <= caratAnchors[index - 1].microCarats) {
      throw new Error('Carat anchors must be strictly increasing');
    }
  }

  const delta = object(source.deltaPpm, 'deltaPpm');
  const criterionClamp = object(source.criterionClampPpm, 'criterionClampPpm');
  const totalClamp = object(source.totalClampPpm, 'totalClampPpm');
  const priceClamp = object(source.priceClampUsd, 'priceClampUsd');
  const matrix: ValuationMatrix = {
    version: text(source.version, 'version'),
    varieties,
    caratAnchors,
    clarityPpm: integerMap(source.clarityPpm, 'clarityPpm'),
    treatmentPpm: integerMap(source.treatmentPpm, 'treatmentPpm'),
    shapes: stringList(source.shapes, 'shapes'),
    deltaPpm: {
      shape: integer(delta.shape, 'deltaPpm.shape'),
      color: integer(delta.color, 'deltaPpm.color'),
      colorGrade: integer(delta.colorGrade, 'deltaPpm.colorGrade'),
    },
    demandPriorCount: integer(source.demandPriorCount, 'demandPriorCount'),
    criterionClampPpm: {
      min: integer(criterionClamp.min, 'criterionClampPpm.min'),
      max: integer(criterionClamp.max, 'criterionClampPpm.max'),
    },
    totalClampPpm: {
      min: integer(totalClamp.min, 'totalClampPpm.min'),
      max: integer(totalClamp.max, 'totalClampPpm.max'),
    },
    priceClampUsd: {
      min: integer(priceClamp.min, 'priceClampUsd.min'),
      max: integer(priceClamp.max, 'priceClampUsd.max'),
    },
  };
  if (matrix.criterionClampPpm.min > matrix.criterionClampPpm.max) {
    throw new Error('Criterion clamp minimum exceeds maximum');
  }
  if (matrix.totalClampPpm.min > matrix.totalClampPpm.max) {
    throw new Error('Total clamp minimum exceeds maximum');
  }
  if (matrix.priceClampUsd.min > matrix.priceClampUsd.max) {
    throw new Error('Price clamp minimum exceeds maximum');
  }
  return matrix;
}

export function canonicalMatrix(matrix: ValuationMatrix): { canonical: string; hash: Hash } {
  const canonical = canonicalize(matrixDocument(matrix));
  return { canonical, hash: keccak256(toBytes(canonical)) };
}

export interface ActiveMatrix {
  id: string | null;
  matrix: ValuationMatrix;
  document: JsonRecord;
  canonical: string;
  hash: Hash;
  state: 'active';
}

/**
 * The exact built-in current matrix is the compatibility baseline. Once an
 * admin activates a database version, every new appraisal uses that snapshot.
 */
export async function activeMatrix(
  admin: SupabaseClient,
  deploymentId: string,
): Promise<ActiveMatrix> {
  const { data, error } = await admin
    .from('valuation_matrix_versions')
    .select('id,matrix_document,canonical_document,matrix_hash')
    .eq('deployment_id', deploymentId)
    .eq('state', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const document = matrixDocument(VALUATION_MATRIX);
    const { canonical, hash } = canonicalMatrix(VALUATION_MATRIX);
    return { id: null, matrix: VALUATION_MATRIX, document, canonical, hash, state: 'active' };
  }
  const matrix = parseMatrixDocument(data.matrix_document);
  const computed = canonicalMatrix(matrix);
  if (computed.canonical !== data.canonical_document || computed.hash !== data.matrix_hash) {
    throw new Error('The active valuation matrix failed its integrity check');
  }
  return {
    id: data.id,
    matrix,
    document: data.matrix_document as JsonRecord,
    canonical: computed.canonical,
    hash: computed.hash,
    state: 'active',
  };
}
