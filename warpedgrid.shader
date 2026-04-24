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
#define PI 3.14159265358

float smoothmix(float a, float b, float x)
{
    return (1.0-smoothstep(0.0, 1.0, x))*a + smoothstep(0.0, 1.0, x)*b;
}

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

mat2 scale2D(float scalar)
{
    return mat2(scalar, 0.0,
                0.0, scalar);
}

float smoothMin(float a, float b, float softness)
{
    float h = clamp(0.5 + 0.5*(b - a)/softness, 0.0, 1.0);
    return mix(b, a, h) - softness*h*(1.0 - h);
}

float random(float x)
{
    return fract(439029.0*sin(x));
}

float random(vec2 uv)
{
    return fract(439029.0*sin(dot(uv, vec2(85.3876, 9.38532))));
}

vec2 randomGradientVec(vec2 uv)
{
    float angle = 2.0*PI*random(uv);
    return vec2(cos(angle), sin(angle));
}

float noise(in vec2 uv, in float sampleNum)
{
    /*
        Creates gradients at sample points
        
        Quadrants 1, 2, 3, 4 correspond to letters d, c, a, b
    */
    vec2 uv_i = floor(uv*sampleNum);
    vec2 uv_f = fract(uv*sampleNum);
    float time_i = floor(iTime);
    float time_f = fract(iTime);
    
    vec2 gradA = randomGradientVec(uv_i);
    vec2 gradB = randomGradientVec(uv_i + vec2(1.0, 0.0));
    vec2 gradC = randomGradientVec(uv_i + vec2(0.0, 1.0));
    vec2 gradD = randomGradientVec(uv_i + vec2(1.0, 1.0));
    
    /*
        Dot product and interpolation to get noise value at each pixel
    */
    float valA = dot(uv_f, gradA);
    float valB = dot(uv_f - vec2(1.0, 0.0), gradB);
    float valC = dot(uv_f - vec2(0.0, 1.0), gradC);
    float valD = dot(uv_f - vec2(1.0, 1.0), gradD);
    float valAB = smoothmix(valA, valB, uv_f.x);
    float valBC = smoothmix(valC, valD, uv_f.x);
    float val = 0.8*smoothmix(valAB, valBC, uv_f.y) + 0.5;
    
    return val;
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
    uv *= 2.0;

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