export interface NoiseParameterValues {
  renderWidth: number;
  renderHeight: number;
  force: number;
  scale: number;
  gridSparseness: number;
  showHeatmap: boolean;
  vectorOverlayDensity: number;
  spectralSlopeDbPerOct: number;
  amplitudeContrast: number;
  swirlDensity: number;
  swirlMinimumAngleDegrees: number;
  swirlStrengthPercent: number;
  swirlFalloff: number;
  swirlDirectionBias: number;
  directionNoiseMix: number;
  randomSeed: string;
}

export type NoiseNumericParameterKey = Exclude<
  keyof NoiseParameterValues,
  "randomSeed" | "showHeatmap"
>;

export type NoiseBooleanParameterKey = Extract<
  keyof NoiseParameterValues,
  "showHeatmap"
>;

export interface NoiseParameterGroup {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export interface NoiseNumericParameterDefinition {
  readonly group: string;
  readonly key: NoiseNumericParameterKey;
  readonly label: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer: boolean;
}

export interface NoiseSeedParameterDefinition {
  readonly group: string;
  readonly key: "randomSeed";
  readonly label: string;
  readonly description: string;
}

export interface NoiseBooleanParameterDefinition {
  readonly group: string;
  readonly key: NoiseBooleanParameterKey;
  readonly label: string;
  readonly description: string;
}

export type NoiseParameterDefinition =
  | NoiseNumericParameterDefinition
  | NoiseBooleanParameterDefinition
  | NoiseSeedParameterDefinition;

export interface NoisePreviewSchemaResponse {
  readonly defaultParameters: NoiseParameterValues;
  readonly parameterGroups: readonly NoiseParameterGroup[];
  readonly parameterDefinitions: readonly NoiseParameterDefinition[];
}

export interface NoisePreviewRequest {
  readonly parameters: Partial<NoiseParameterValues>;
}

export interface NoisePreviewResponse {
  readonly parameters: NoiseParameterValues;
  readonly svg: string;
}

export class NoisePreviewRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoisePreviewRequestError";
  }
}

export function parseNoisePreviewRequest(body: string): NoisePreviewRequest {
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new NoisePreviewRequestError("Noise preview request body must be valid JSON.");
  }

  if (!isObjectRecord(parsedBody)) {
    throw new NoisePreviewRequestError("Noise preview request body must be a JSON object.");
  }

  const { parameters } = parsedBody;
  if (!isObjectRecord(parameters)) {
    throw new NoisePreviewRequestError("Noise preview request must include a parameters object.");
  }

  const requestParameters: Partial<NoiseParameterValues> = { ...parameters };

  return {
    parameters: requestParameters,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}