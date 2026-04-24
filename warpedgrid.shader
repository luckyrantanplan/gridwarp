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
float grid(in vec2 uv, in float size)
{
    uv = fract(uv);
    return smoothstep(0.0, size*0.05, abs(uv.x-0.5))
            *smoothstep(0.0, size*0.05, abs(uv.y-0.5));
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

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsv2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
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


    float warpedGrid = grid(warpedUv, 1.0);
    
    /*
        Coloring
    */
    
    vec3 HSV = vec3(0.0, 0.0, 0.0);
    HSV[0] = 0.0;
    HSV[1] = 0.0;
    HSV[2] =  warpedGrid ;
    vec3 color = hsv2rgb(HSV);
    fragColor = vec4(color, 1.0);
}