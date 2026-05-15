import type {
  NoiseBooleanParameterDefinition,
  NoiseEditableParameterValues,
  NoiseNumericParameterDefinition,
  NoiseParameterDefinition,
  NoiseParameterGroup,
  NoiseParameterValues,
  NoisePreviewResponse,
  NoisePreviewSchemaResponse,
  NoiseSeedParameterDefinition,
} from "../shared/noise-preview.js";
import type { WarpGeometry } from "../shared/warp-request.js";

const PREVIEW_DEBOUNCE_MS = 160;

const controlsElement = requireElement("noise-controls", (element): element is HTMLFormElement => element instanceof HTMLFormElement);
const previewElement = requireElement("noise-preview", (element): element is HTMLDivElement => element instanceof HTMLDivElement);
const statusElement = requireElement("noise-status", (element): element is HTMLSpanElement => element instanceof HTMLSpanElement);

let previewTimeout = 0;
let activeRequestId = 0;
let activeController: AbortController | null = null;
let currentSchema: NoisePreviewSchemaResponse | null = null;
let currentParameters: NoiseParameterValues | null = null;
let geometryProvider: (() => WarpGeometry) | null = null;
let parametersChangedCallback: ((parameters: NoiseEditableParameterValues) => void) | null = null;

export async function initializeNoisePreview(
  nextGeometryProvider: () => WarpGeometry,
  nextParametersChangedCallback: (parameters: NoiseEditableParameterValues) => void,
): Promise<void> {
  geometryProvider = nextGeometryProvider;
  parametersChangedCallback = nextParametersChangedCallback;
  await initializeNoisePreviewAsync();
  parametersChangedCallback(copyParameters(getCurrentParameters()));
}

async function initializeNoisePreviewAsync(): Promise<void> {
  statusElement.textContent = "Loading";

  try {
    const response = await fetch("/api/noise/schema");
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Noise schema request failed with status ${String(response.status)}.`);
    }

    currentSchema = await response.json() as NoisePreviewSchemaResponse;
    currentParameters = copyParameters(currentSchema.defaultParameters);
    rebuildControls();
    await requestPreview(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown noise schema error";
    previewElement.textContent = message;
    statusElement.textContent = "Unavailable";
    throw error;
  }
}

function requireElement<TElement extends Element>(
  id: string,
  predicate: (element: Element) => element is TElement,
): TElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required noise preview element ${id}.`);
  }
  if (!predicate(element)) {
    throw new Error(`Noise preview element ${id} did not match the expected type.`);
  }
  return element;
}

function getCurrentSchema(): NoisePreviewSchemaResponse {
  if (currentSchema === null) {
    throw new Error("Noise preview schema has not loaded yet.");
  }
  return currentSchema;
}

function getCurrentParameters(): NoiseParameterValues {
  if (currentParameters === null) {
    throw new Error("Noise preview parameters are not initialized.");
  }
  return currentParameters;
}

function getCurrentGeometry(): WarpGeometry {
  if (geometryProvider === null) {
    throw new Error("Noise preview geometry provider is not initialized.");
  }
  return geometryProvider();
}

function copyParameters(parameters: NoiseParameterValues): NoiseParameterValues {
  return {
    force: parameters.force,
    scale: parameters.scale,
    silenceCutoffPercent: parameters.silenceCutoffPercent,
    gridSparseness: parameters.gridSparseness,
    showHeatmap: parameters.showHeatmap,
    vectorOverlayDensity: parameters.vectorOverlayDensity,
    spectralSlopeDbPerOct: parameters.spectralSlopeDbPerOct,
    amplitudeContrast: parameters.amplitudeContrast,
    swirlDensity: parameters.swirlDensity,
    swirlMinimumAngleDegrees: parameters.swirlMinimumAngleDegrees,
    swirlStrengthPercent: parameters.swirlStrengthPercent,
    swirlFalloff: parameters.swirlFalloff,
    swirlDirectionBias: parameters.swirlDirectionBias,
    directionNoiseMix: parameters.directionNoiseMix,
    randomSeed: parameters.randomSeed,
  };
}

function rebuildControls(): void {
  const schema = getCurrentSchema();
  const parameters = getCurrentParameters();
  controlsElement.replaceChildren();
  buildControls(
    controlsElement,
    schema.parameterGroups,
    schema.parameterDefinitions,
    parameters,
  );
}

function buildControls(
  form: HTMLFormElement,
  groups: readonly NoiseParameterGroup[],
  definitions: readonly NoiseParameterDefinition[],
  parameters: NoiseParameterValues,
): void {
  const definitionsByGroup = groupParameterDefinitions(definitions);

  for (const group of groups) {
    const groupedDefinitions = definitionsByGroup.get(group.key);
    if (groupedDefinitions === undefined) {
      continue;
    }

    const section = document.createElement("section");
    section.className = "control-group";

    const heading = document.createElement("h3");
    heading.className = "control-group-title";
    heading.textContent = group.label;

    const description = document.createElement("p");
    description.className = "control-group-description";
    description.textContent = group.description;

    section.append(heading, description);

    for (const definition of groupedDefinitions) {
      section.appendChild(createControl(definition, parameters));
    }

    form.appendChild(section);
  }
}

function groupParameterDefinitions(
  definitions: readonly NoiseParameterDefinition[],
): Map<string, NoiseParameterDefinition[]> {
  const groupedDefinitions = new Map<string, NoiseParameterDefinition[]>();

  for (const definition of definitions) {
    const existingGroup = groupedDefinitions.get(definition.group);
    if (existingGroup === undefined) {
      groupedDefinitions.set(definition.group, [definition]);
      continue;
    }
    existingGroup.push(definition);
  }

  return groupedDefinitions;
}

function createControl(
  definition: NoiseParameterDefinition,
  parameters: NoiseParameterValues,
): HTMLElement {
  if (definition.key === "randomSeed") {
    return createSeedControl(definition, parameters);
  }
  if (definition.key === "showHeatmap") {
    return createBooleanControl(definition, parameters);
  }
  return createNumericControl(definition, parameters);
}

function createBooleanControl(
  definition: NoiseBooleanParameterDefinition,
  parameters: NoiseParameterValues,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "control";

  const label = document.createElement("label");
  label.htmlFor = definition.key;
  label.appendChild(createLabelContent(definition.label, definition.description));

  const input = document.createElement("input");
  input.id = definition.key;
  input.name = definition.key;
  input.type = "checkbox";
  input.checked = parameters[definition.key];
  input.addEventListener("input", () => {
    parameters[definition.key] = input.checked;
    queuePreviewRefresh();
  });

  applyTooltip([wrapper, label, input], definition.description);
  wrapper.append(label, input);
  return wrapper;
}

function createSeedControl(
  definition: NoiseSeedParameterDefinition,
  parameters: NoiseParameterValues,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "control";

  const label = document.createElement("label");
  label.htmlFor = definition.key;
  label.appendChild(createLabelContent(definition.label, definition.description));

  const input = document.createElement("input");
  input.id = definition.key;
  input.name = definition.key;
  input.type = "text";
  input.value = parameters.randomSeed;
  input.addEventListener("input", () => {
    parameters.randomSeed = input.value;
    queuePreviewRefresh();
  });

  applyTooltip([wrapper, label, input], definition.description);
  wrapper.append(label, input);
  return wrapper;
}

function createNumericControl(
  definition: NoiseNumericParameterDefinition,
  parameters: NoiseParameterValues,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "control";

  const label = document.createElement("label");
  label.htmlFor = definition.key;
  const labelText = createLabelContent(definition.label, definition.description);
  const valueOutput = document.createElement("span");
  valueOutput.textContent = String(parameters[definition.key]);
  label.append(labelText, valueOutput);

  const row = document.createElement("div");
  row.className = "value-row";

  const rangeInput = document.createElement("input");
  rangeInput.id = definition.key;
  rangeInput.name = definition.key;
  rangeInput.type = "range";
  rangeInput.min = String(definition.min);
  rangeInput.max = String(definition.max);
  rangeInput.step = String(definition.step);
  rangeInput.value = String(parameters[definition.key]);

  const numberInput = document.createElement("input");
  if (definition.integer) {
    numberInput.type = "number";
    numberInput.min = String(definition.min);
    numberInput.max = String(definition.max);
    numberInput.step = String(definition.step);
  } else {
    numberInput.type = "text";
    numberInput.inputMode = "decimal";
    numberInput.setAttribute("aria-label", definition.label);
  }
  numberInput.value = String(parameters[definition.key]);

  applyTooltip(
    [wrapper, label, valueOutput, rangeInput, numberInput],
    definition.description,
  );

  const commitValue = (rawValue: string, writeBackToInput: boolean): void => {
    const nextValue = parseNumericControlValue(rawValue, definition);
    if (nextValue === null) {
      if (writeBackToInput) {
        numberInput.value = String(parameters[definition.key]);
      }
      return;
    }

    parameters[definition.key] = nextValue;
    rangeInput.value = String(nextValue);
    valueOutput.textContent = String(nextValue);
    if (writeBackToInput) {
      numberInput.value = String(nextValue);
    }
    queuePreviewRefresh();
  };

  rangeInput.addEventListener("input", () => {
    commitValue(rangeInput.value, true);
  });

  numberInput.addEventListener("input", () => {
    const nextValue = parseNumericControlValue(numberInput.value, definition);
    if (nextValue === null) {
      return;
    }

    parameters[definition.key] = nextValue;
    rangeInput.value = String(nextValue);
    valueOutput.textContent = String(nextValue);
    queuePreviewRefresh();
  });

  numberInput.addEventListener("change", () => {
    commitValue(numberInput.value, true);
  });

  numberInput.addEventListener("blur", () => {
    commitValue(numberInput.value, true);
  });

  row.append(rangeInput, numberInput);
  wrapper.append(label, row);
  return wrapper;
}

function createLabelContent(text: string, description: string): HTMLElement {
  const content = document.createElement("span");
  content.className = "label-main";

  const textNode = document.createElement("span");
  textNode.textContent = text;

  const indicator = document.createElement("span");
  indicator.className = "tooltip-indicator";
  indicator.textContent = "?";
  indicator.title = description;
  indicator.setAttribute("aria-label", description);

  content.append(textNode, indicator);
  return content;
}

function applyTooltip(elements: HTMLElement[], description: string): void {
  for (const element of elements) {
    element.title = description;
  }
}

function parseNumericControlValue(
  rawValue: string,
  definition: NoiseNumericParameterDefinition,
): number | null {
  const normalizedValue = rawValue.trim().replace(/,/g, ".");
  if (
    normalizedValue.length === 0 ||
    normalizedValue === "." ||
    normalizedValue === "+" ||
    normalizedValue === "-" ||
    normalizedValue.endsWith(".")
  ) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  const roundedValue = definition.integer ? Math.round(parsedValue) : parsedValue;
  return Math.min(definition.max, Math.max(definition.min, roundedValue));
}

function queuePreviewRefresh(): void {
  window.clearTimeout(previewTimeout);
  previewTimeout = window.setTimeout(() => {
    void requestPreview(true);
  }, PREVIEW_DEBOUNCE_MS);
}

async function requestPreview(notifyParametersChanged: boolean): Promise<void> {
  const parameters = getCurrentParameters();
  activeRequestId += 1;
  const requestId = activeRequestId;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  statusElement.textContent = "Rendering";
  previewElement.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("/api/noise/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ geometry: getCurrentGeometry(), parameters }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Noise preview request failed with status ${String(response.status)}.`);
    }

    const payload = await response.json() as NoisePreviewResponse;
    if (requestId !== activeRequestId) {
      return;
    }

    previewElement.innerHTML = payload.svg;
    previewElement.setAttribute("aria-busy", "false");
    statusElement.textContent = "Ready";

    if (!noiseParametersEqual(parameters, payload.parameters)) {
      currentParameters = copyParameters(payload.parameters);
      rebuildControls();
    }

    if (notifyParametersChanged) {
      parametersChangedCallback?.(copyParameters(getCurrentParameters()));
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown noise preview error";
    previewElement.textContent = message;
    previewElement.setAttribute("aria-busy", "false");
    statusElement.textContent = "Render failed";
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
  }
}

function noiseParametersEqual(
  left: NoiseParameterValues,
  right: NoiseParameterValues,
): boolean {
  return (
    left.force === right.force &&
    left.scale === right.scale &&
    left.silenceCutoffPercent === right.silenceCutoffPercent &&
    left.gridSparseness === right.gridSparseness &&
    left.showHeatmap === right.showHeatmap &&
    left.vectorOverlayDensity === right.vectorOverlayDensity &&
    left.spectralSlopeDbPerOct === right.spectralSlopeDbPerOct &&
    left.amplitudeContrast === right.amplitudeContrast &&
    left.swirlDensity === right.swirlDensity &&
    left.swirlMinimumAngleDegrees === right.swirlMinimumAngleDegrees &&
    left.swirlStrengthPercent === right.swirlStrengthPercent &&
    left.swirlFalloff === right.swirlFalloff &&
    left.swirlDirectionBias === right.swirlDirectionBias &&
    left.directionNoiseMix === right.directionNoiseMix &&
    left.randomSeed === right.randomSeed
  );
}

window.addEventListener("beforeunload", () => {
  window.clearTimeout(previewTimeout);
  activeController?.abort();
});