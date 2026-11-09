export type Criterion = {
    id: string;
    text: string;
    weight?: number;
};
export type EvalCase = {
    id: string;
    input: string;
    checks?: {
        must_match?: string[];
        must_not_match?: string[];
    };
    rubric?: Criterion[];
};
export type ModelSpec = {
    model: string; /** USD per million tokens, [input, output]. */
    usdPerMTok?: [number, number];
};
export type Verdict = {
    id: string;
    pass: boolean;
    reason: string;
};
/** One line of `eval-results.json`. */
export type EvalRow = {
    id: string;
    pass: boolean;
    score: number;
    failedChecks: string[];
    criteria: Verdict[];
    retried: boolean;
    costUsd: number;
    output: string;
};
export type EvalResult = {
    rows: EvalRow[];
    passRate: number;
    ok: boolean;
    regressions: string[];
    costUsd: number;
    aborted: boolean;
};
export type EvalOptions = {
    /** SKILL.md text; null runs the baseline without the skill. */
    skill: string | null;
    /** Pack directory whose rules join the system prompt, as at Run start. */
    packDir?: string;
    cases: EvalCase[];
    subject: ModelSpec;
    judge: ModelSpec;
    caseThreshold?: number;
    suiteThreshold?: number;
    maxUsd?: number;
    maxCases?: number;
    /** Rows of the last `main` run: a case that passed there must still pass. */
    baseline?: EvalRow[];
    /** Defaults to BAUHERR_GATEWAY_URL / BAUHERR_GATEWAY_KEY. */
    gateway?: {
        url: string;
        key: string;
    };
    /** `X-Bauherr-Run` attribution, e.g. `ci-123`. */
    runLabel?: string;
};
export declare function runChecks(output: string, checks?: EvalCase['checks']): string[];
/** Reads `<dir>/*.yaml` eval cases. */
export declare function loadCases(dir: string): EvalCase[];
export declare function runEval(o: EvalOptions): Promise<EvalResult>;
