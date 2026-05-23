export interface DictionaryGenerationResult {
  readonly tableCount: number;
  readonly columnCount: number;
  readonly generatedFiles: readonly string[];
}

export async function generateDictionary(): Promise<DictionaryGenerationResult> {
  throw new Error("generateDictionary is not implemented yet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateDictionary().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
