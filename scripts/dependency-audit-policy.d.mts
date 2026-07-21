export interface AuditFinding {
  severity?: string;
  via?: Array<string | { url?: string }>;
  fixAvailable?: unknown;
}

export interface ClassifiedAuditFinding {
  name: string;
  severity: unknown;
  reason?: string;
  via?: AuditFinding["via"];
  fixAvailable?: unknown;
}

export function classifyVulnerabilities(vulnerabilities: Record<string, AuditFinding>): {
  ok: boolean;
  allowed: ClassifiedAuditFinding[];
  unexpected: ClassifiedAuditFinding[];
};
