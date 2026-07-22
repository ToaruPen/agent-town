export type RunnerResult = { ok: true; text: string } | { ok: false; error: string };

export interface LlmRunner {
  run(prompt: string): Promise<RunnerResult>;
}
