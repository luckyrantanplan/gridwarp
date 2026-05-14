Task: Refactor gridwarp to a client/server architecture (server-side compute)

Objective
Move all grid warping computation from the browser to a Node.js server. The browser remains responsible only for UI state, user interaction, and displaying the returned SVG. The server exposes a single API endpoint that receives the current demo state, performs the warp and optional overlay rendering, and returns the fully computed SVG.

Priority Order

    1. Move all warp and grid computation out of the browser module.

    2. Preserve the current fixed-shape demo's visual output and interaction behavior after that move.

    3. Use the noise_generator runtime and tooling pattern for file layout, scripts, and browser-module serving.

Architecture Target

    Server (Node.js): Stateless compute. Receives request data, performs warp + overlay generation, and returns the final SVG.

    Client (browser HTML/JS): Pure UI. Captures current control values, sends them to the server, and replaces the displayed SVG with the server response. No warping or grid-generation logic remains in the browser module.

    noise_generator reference pattern:

        Use plain TypeScript source files, not TSX.

        Follow the same split used in noise_generator: server code under a server-focused source area, browser UI under a client-focused source area, and shared request/type definitions in a shared source area.

        Mirror noise_generator's development flow: run the Node server directly from TypeScript, and serve browser modules as plain JavaScript by stripping TypeScript syntax on the server side.

        Reuse the same package script style and static file serving approach as noise_generator when that approach still satisfies gridwarp's architecture and API requirements.

Current Scope

    This migration should match the current fixed-shape gridwarp demo, not introduce arbitrary SVG editing as part of the required server contract.

    The request contract must cover the current live inputs that already affect output in gridwarp.

    Arbitrary SVG input may be added later, but it is not part of the required scope for this refactor.

API Endpoint Specification

Endpoint
POST /api/warp

Request (JSON body)
json

{
  "geometry": {
    "shape": "octagon-demo"
  },
  "renderWidth": 800,
  "renderHeight": 800,
  "time": 12,
  "sampleGridSize": 33,
  "gain": 1.5,
  "plateau": 0.65,
  "gridVisible": true,
  "diagonalsVisible": false
}

    geometry: Encodes the current fixed demo geometry. For this refactor, match the existing octagon-based demo rather than accepting arbitrary SVG markup.

    renderWidth: Output width used by the warp and contour pipeline.

    renderHeight: Output height used by the warp and contour pipeline.

    time: Current warp-strength control used by the existing demo.

    sampleGridSize: Resolution of the scalar and direction sampling grids.

    gain: Numeric gain value applied to the scalar surface.

    plateau: Plateau/clamp parameter applied to the scalar surface.

    gridVisible: Whether the grid-derived contour overlay should be included in the returned SVG.

    diagonalsVisible: Whether the octagon diagonal overlay should be included in the returned SVG.

    Do not invent additional request fields unless they correspond to real current gridwarp inputs. In particular, do not treat gridSpacing, warpIntensity, warp method, curve tension, or anchor points as required current parameters unless the implementation first introduces them deliberately.

Response (JSON)
json

{
  "svg": "<svg>...warped result with optional overlays...</svg>"
}

    svg: The complete computed SVG as a string. When gridVisible or diagonalsVisible is enabled, the returned SVG must already include those overlays. The client does no additional composition.

Error Handling

    Return 400 Bad Request with a descriptive message if required fields are missing, malformed, or outside the supported range.

    If geometry.shape is not a polygon with additional polylines, return 400 with a message  

    If renderWidth or renderHeight is not a positive finite number, return 400 with a message that both dimensions must be positive numeric values.

    If time, sampleGridSize, gain, or plateau is not a finite number, return 400 with a message that the affected field must be numeric.

    If gridVisible or diagonalsVisible is not a boolean, return 400 with a message that the affected field must be true or false.

    Return 500 Internal Server Error if the computation fails.

Client-Side Changes

    Remove all warping and overlay-generation code from the browser module.

    Replace that logic with a fetch call to POST /api/warp.

    The browser remains responsible for:

        Collecting the current control values.

        Sending the request payload.

        Replacing the displayed SVG with the returned SVG.

        Re-requesting the endpoint whenever gridVisible or diagonalsVisible changes.

    Keep the client in TypeScript source form, but serve it to the browser as plain JavaScript using the same TypeScript-stripping approach used by noise_generator.

Implementation Checklist

    Extract the pure warp/overlay computation from the current browser path into a server-callable module.

    Define a shared request/response schema that lists every supported field exactly once.

    Create POST /api/warp and have it parse the JSON body, call the extracted computation, and return the SVG payload.

    Restructure gridwarp to follow the noise_generator layout pattern for client, server, and shared modules.

    Strip the browser module down to UI state collection, fetch, and SVG replacement.

    Serve the HTML shell and browser module from the Node server using the same source-served TypeScript-stripping pattern used in noise_generator.

    Add focused tests for the server route, the browser-module serving path, and the POST /api/warp response.

Validation Expectations

    Verify the server route independently before wiring the client.

    Verify the browser module contains no warp or grid-generation logic after the refactor.

    Verify the full flow for the existing demo inputs with gridVisible both on and off, and with diagonalsVisible both on and off.

Acceptance Criteria

    No warping or overlay-generation code remains in the browser module.

    POST /api/warp returns a complete SVG for the current fixed-shape demo state.

    Every supported request field is defined in a shared schema/module rather than being rediscovered separately in client and server code.

    The server serves the HTML shell and browser module using the same TypeScript-stripping pattern used by noise_generator.

    The UI behaves the same as the current version from the user's perspective for the existing demo controls.

Please align the implementation choices with the actual conventions in noise_generator: plain TypeScript source, Node server entrypoint, shared parameter/type definitions, and server-side stripping of browser TypeScript to JavaScript.