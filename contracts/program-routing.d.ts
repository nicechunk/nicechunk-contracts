export interface RuntimeProgramConfig {
  chain?: {
    programs?: Record<string, unknown>;
  };
}

export interface SourceProgramAddress {
  codeKey?: string;
  programId?: string;
}

export interface ProgramAccountDataSizeRange {
  min?: number;
  max?: number;
}

export interface ProgramAccountScanTarget {
  programKey: string;
  sizes: Array<number | ProgramAccountDataSizeRange>;
}

export const programAccountScanTargets: Readonly<Record<string, ProgramAccountScanTarget[]>>;

export function getProgramAccountScanTargets(
  typeId: string,
  programKey?: string | null,
): ProgramAccountScanTarget[];

export function mapProgramAccountTypes(
  scanTargetsByType?: Readonly<Record<string, ProgramAccountScanTarget[]>>,
): Map<string, string[]>;

export function resolveProgramAddress(
  programKey: string,
  runtimeConfig: RuntimeProgramConfig | null | undefined,
  sourcePrograms?: SourceProgramAddress[],
): string | null;
