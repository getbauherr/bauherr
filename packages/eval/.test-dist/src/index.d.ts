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
    calls: number;
};
export type EvalOptions = {
    skill: string | null;
    packDir?: string;
    cases: EvalCase[];
    subject: ModelSpec;
    judge: ModelSpec;
    caseThreshold?: number;
    suiteThreshold?: number;
    maxUsd?: number;
    maxCases?: number;
    maxCalls?: number;
    retry?: boolean;
    cache?: Map<string, EvalRow>;
    baseline?: EvalRow[];
    gateway?: {
        url: string;
        key: string;
    };
    runLabel?: string;
};
export declare const evalKey: (skill: string | null, c: EvalCase) => string;
export declare function runChecks(output: string, checks?: EvalCase['checks']): string[];
export declare function loadCases(dir: string): EvalCase[];
export declare function runEval(o: EvalOptions): Promise<EvalResult>;
