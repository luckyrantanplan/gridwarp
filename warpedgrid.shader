/*

Shader Inputs

uniform vec3      iResolution;           // viewport resolution (in pixels)
uniform float     iTime;                 // shader playback time (in seconds)
uniform float     iTimeDelta;            // render time (in seconds)
uniform float     iFrameRate;            // shader frame rate
uniform int       iFrame;                // shader playback frame
uniform float     iChannelTime[4];       // channel playback time (in seconds)
uniform vec3      iChannelResolution[4]; // channel resolution (in pixels)
uniform vec4      iMouse;                // mouse pixel coords. xy: current (if MLB down), zw: click
uniform samplerXX iChannel0..3;          // input channel. XX = 2D/Cube 
uniform vec4      iDate;                 // (year, month, day, time in seconds)
uniform float     iSampleRate;           // sound sample rate (i.e., 44100)
                

*/
float verticalLine(in vec2 uv, in float size)
{
    uv = fract(uv);
    return 1.0 - smoothstep(0.0, size*0.05, abs(uv.x - 0.5));
}

float horizontalLine(in vec2 uv, in float size)
{
    uv = fract(uv);
    return 1.0 - smoothstep(0.0, size*0.05, abs(uv.y - 0.5));
}

float distanceToSegment(in vec2 point, in vec2 startPoint, in vec2 endPoint)
{
    vec2 segment = endPoint - startPoint;
    float segmentLengthSquared = dot(segment, segment);
    float t = clamp(dot(point - startPoint, segment) / segmentLengthSquared, 0.0, 1.0);
    vec2 projection = startPoint + t * segment;
    return length(point - projection);
}

float segmentMask(in vec2 point, in vec2 startPoint, in vec2 endPoint, in float halfWidth)
{
    float distance = distanceToSegment(point, startPoint, endPoint);
    float antialias = fwidth(distance);
    return 1.0 - smoothstep(halfWidth, halfWidth + antialias, distance);
}

float triangleOutlineMask(in vec2 point, in vec2 pointA, in vec2 pointB, in vec2 pointC, in float halfWidth)
{
    float mask = 0.0;
    mask = max(mask, segmentMask(point, pointA, pointB, halfWidth));
    mask = max(mask, segmentMask(point, pointB, pointC, halfWidth));
    mask = max(mask, segmentMask(point, pointC, pointA, halfWidth));
    return mask;
}

mat2 rotate2D(float angle)
{
    return mat2(cos(angle), -sin(angle),
                sin(angle), cos(angle));
}

float smootherstep(float edge0, float edge1, float x)
{
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

float smoothMin(float a, float b, float softness)
{
    float h = smootherstep(-softness, softness, b - a);
    return mix(b, a, h);
}


// ------------------------------------------------------------------


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord - 0.5*iResolution.xy)/iResolution.y;
    
    /*
        Warps the uv coordinates and draws grid
    */
    uv *= 10.0;

    float radius = length(uv);
    float centerWeight = exp(-0.16*radius*radius);
    float curl = iTime*(0.0022 + 0.01*centerWeight);
    float inwardPull = iTime*(0.015 + 0.075*centerWeight);

    vec2 warpedUv = rotate2D(curl*centerWeight)*uv;
    warpedUv *= smoothMin(3.0, 1.0 + inwardPull*centerWeight, 0.2);

    float horizontalGrid = horizontalLine(warpedUv, 1.0);
    float verticalGrid = verticalLine(warpedUv, 1.0);
    float triangleMask = 0.0;

    vec2 triangleA = vec2(-5.2, -1.8);
    vec2 triangleB = vec2(4.8, -1.4);
    vec2 triangleC = vec2(-0.2, 5.2);
    float triangleHalfWidth = 0.06;
    vec2 triangleSpacing = vec2(12.0, 10.0);

    for (int row = -1; row <= 1; ++row)
    {
        for (int column = -1; column <= 2; ++column)
        {
            vec2 offset = vec2(float(column), float(row)) * triangleSpacing;
            triangleMask = max(
                triangleMask,
                triangleOutlineMask(
                    warpedUv,
                    triangleA + offset,
                    triangleB + offset,
                    triangleC + offset,
                    triangleHalfWidth
                )
            );
        }
    }
    
    /*
        Coloring
    */
    
    vec3 color = vec3(1.0);
    color = mix(color, vec3(1.0, 0.0, 0.0), horizontalGrid);
    color = mix(color, vec3(0.0, 1.0, 0.0), verticalGrid);
    color = mix(color, vec3(0.08, 0.2, 0.95), triangleMask);
    fragColor = vec4(color, 1.0);
}