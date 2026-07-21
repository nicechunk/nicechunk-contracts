export interface ResourceDropDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface ResourceDropRule {
  sourceKey: string;
  dropKey: string;
  sourceBlockId: number;
  dropBlockId: number;
  chanceBps: number;
  minAltitude: number;
  maxAltitude: number;
  minDepth: number;
  maxDepth: number;
  salt: number;
  minDimensionsM: ResourceDropDimensions | null;
  maxDimensionsM: ResourceDropDimensions | null;
  minVolumeMm3: number;
  maxVolumeMm3: number;
}

export const resourceDropRuleSet: string;
export const resourceDropRules: ResourceDropRule[];
export const resourceDropSizeProfiles: Record<string, {
  minDimensionsM: ResourceDropDimensions;
  maxDimensionsM: ResourceDropDimensions;
}>;
export function blockIdByKey(key: string): number;
