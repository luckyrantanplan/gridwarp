export interface NoiseEditableParameterValues {
  force: number;
  scale: number;
  silenceCutoffPercent: number;
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
  keyof NoiseEditableParameterValues,
  "randomSeed" | "showHeatmap"
>;

export type NoiseBooleanParameterKey = Extract<
  keyof NoiseEditableParameterValues,
  "showHeatmap"
>;

const NUMERIC_NOISE_PARAMETER_KEYS: readonly NoiseNumericParameterKey[] = [
  "force",
  "scale",
  "silenceCutoffPercent",
  "gridSparseness",
  "vectorOverlayDensity",
  "spectralSlopeDbPerOct",
  "amplitudeContrast",
  "swirlDensity",
  "swirlMinimumAngleDegrees",
  "swirlStrengthPercent",
  "swirlFalloff",
  "swirlDirectionBias",
  "directionNoiseMix",
];

const INTEGER_NOISE_PARAMETER_KEYS = new Set<NoiseNumericParameterKey>([
  "gridSparseness",
  "vectorOverlayDensity",
]);

export function validateNoiseEditableParameters(value: unknown): NoiseEditableParameterValues {
  const partialParameters = validateNoiseEditableParameterRecord(value);

  return {
    force: requireNumericNoiseParameter(partialParameters.force, "force", false),
    scale: requireNumericNoiseParameter(partialParameters.scale, "scale", false),
    silenceCutoffPercent: requireNumericNoiseParameter(partialParameters.silenceCutoffPercent, "silenceCutoffPercent", false),
    gridSparseness: requireNumericNoiseParameter(partialParameters.gridSparseness, "gridSparseness", true),
    showHeatmap: requireBooleanNoiseParameter(partialParameters.showHeatmap, "showHeatmap"),
    vectorOverlayDensity: requireNumericNoiseParameter(partialParameters.vectorOverlayDensity, "vectorOverlayDensity", true),
    spectralSlopeDbPerOct: requireNumericNoiseParameter(partialParameters.spectralSlopeDbPerOct, "spectralSlopeDbPerOct", false),
    amplitudeContrast: requireNumericNoiseParameter(partialParameters.amplitudeContrast, "amplitudeContrast", false),
    swirlDensity: requireNumericNoiseParameter(partialParameters.swirlDensity, "swirlDensity", false),
    swirlMinimumAngleDegrees: requireNumericNoiseParameter(partialParameters.swirlMinimumAngleDegrees, "swirlMinimumAngleDegrees", false),
    swirlStrengthPercent: requireNumericNoiseParameter(partialParameters.swirlStrengthPercent, "swirlStrengthPercent", false),
    swirlFalloff: requireNumericNoiseParameter(partialParameters.swirlFalloff, "swirlFalloff", false),
    swirlDirectionBias: requireNumericNoiseParameter(partialParameters.swirlDirectionBias, "swirlDirectionBias", false),
    directionNoiseMix: requireNumericNoiseParameter(partialParameters.directionNoiseMix, "directionNoiseMix", false),
    randomSeed: requireStringNoiseParameter(partialParameters.randomSeed, "randomSeed"),
  };
}

export function validatePartialNoiseEditableParameters(value: unknown): Partial<NoiseEditableParameterValues> {
  return validateNoiseEditableParameterRecord(value);
}

function validateNoiseEditableParameterRecord(value: unknown): Partial<NoiseEditableParameterValues> {
  if (!isObjectRecord(value)) {
    throw new Error("Noise parameters must be an object.");
  }

  const normalized: Partial<NoiseEditableParameterValues> = {};
  for (const key of Object.keys(value)) {
    if (!isEditableNoiseParameterKey(key)) {
      throw new Error(`Unknown noise parameter: ${key}.`);
    }
  }

  for (const key of NUMERIC_NOISE_PARAMETER_KEYS) {
    if (key in value) {
      normalized[key] = requireNumericNoiseParameter(value[key], key, INTEGER_NOISE_PARAMETER_KEYS.has(key));
    }
  }

  if ("showHeatmap" in value) {
    normalized.showHeatmap = requireBooleanNoiseParameter(value.showHeatmap, "showHeatmap");
  }

  if ("randomSeed" in value) {
    normalized.randomSeed = requireStringNoiseParameter(value.randomSeed, "randomSeed");
  }

  return normalized;
}

function isEditableNoiseParameterKey(value: string): value is keyof NoiseEditableParameterValues {
  return value === "force"
    || value === "scale"
    || value === "silenceCutoffPercent"
    || value === "gridSparseness"
    || value === "showHeatmap"
    || value === "vectorOverlayDensity"
    || value === "spectralSlopeDbPerOct"
    || value === "amplitudeContrast"
    || value === "swirlDensity"
    || value === "swirlMinimumAngleDegrees"
    || value === "swirlStrengthPercent"
    || value === "swirlFalloff"
    || value === "swirlDirectionBias"
    || value === "directionNoiseMix"
    || value === "randomSeed";
}

function requireNumericNoiseParameter(value: unknown, key: string, integer: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Noise parameter ${key} must be a finite number.`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`Noise parameter ${key} must be an integer.`);
  }
  return value;
}

function requireBooleanNoiseParameter(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Noise parameter ${key} must be a boolean.`);
  }
  return value;
}

function requireStringNoiseParameter(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Noise parameter ${key} must be a non-empty string.`);
  }
  return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}