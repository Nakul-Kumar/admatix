export interface LedgerVerificationResult {
  readonly ok: boolean;
  readonly checkedRows: number;
}

export async function verifyLedgerChain(): Promise<LedgerVerificationResult> {
  throw new Error("verifyLedgerChain is not implemented yet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await verifyLedgerChain();
}
