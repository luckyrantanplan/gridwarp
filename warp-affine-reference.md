# Warp as a Pointwise Complex Affine Map

This note rewrites the shader warp in the form

$$
w(x,y) = a(x,y)\,z(x,y) + b(x,y)
$$

where $z(x,y)$ is the complex form of the input coordinate and where $a$ and $b$ may vary from point to point.

## 1. Complex coordinate associated with `fragCoord`

In the shader,

```glsl
vec2 uv = (fragCoord - 0.5*iResolution.xy)/iResolution.y;
uv *= 10.0;
```

Define the complex number

$$
z(x,y) = u(x,y) + i v(x,y)
$$

with

$$
u(x,y) = 10\frac{x - \tfrac12 iResolution_x}{iResolution_y}
$$

$$
v(x,y) = 10\frac{y - \tfrac12 iResolution_y}{iResolution_y}
$$

So $z(x,y)$ is exactly the scaled version of `uv` interpreted as a complex number.

## 2. Radial quantities used by the warp

The shader computes

```glsl
float radius = length(uv);
float centerWeight = exp(-0.16*radius*radius);
float curl = iTime*(0.0022 + 0.01*centerWeight);
float inwardPull = iTime*(0.015 + 0.075*centerWeight);
```

Since $|z| = \text{length}(uv)$, define

$$
r(x,y) = |z(x,y)|
$$

$$
c(x,y) = e^{-0.16 r(x,y)^2}
$$

Then

$$
\operatorname{curl}(x,y) = iTime\,(0.0022 + 0.01\,c(x,y))
$$

$$
\operatorname{inwardPull}(x,y) = iTime\,(0.015 + 0.075\,c(x,y))
$$

## 3. Rotation and scaling in complex form

The shader then applies

```glsl
vec2 warpedUv = rotate2D(curl*centerWeight)*uv;
warpedUv *= smoothMin(3.0, 1.0 + inwardPull*centerWeight, 0.2);
```

This is a rotation followed by a scalar multiplication.

### Rotation part

The rotation angle is

$$
\theta(x,y) = \operatorname{curl}(x,y)\,c(x,y)
$$

In complex notation, rotation by angle $\theta$ is multiplication by

$$
e^{i\theta(x,y)} = \cos \theta(x,y) + i \sin \theta(x,y)
$$

### Scale part

The scale factor is

$$
s(x,y) = \operatorname{smoothMin}\left(3, 1 + \operatorname{inwardPull}(x,y)\,c(x,y), 0.2\right)
$$

## 4. Final expression of the warp

Putting both effects together,

$$
w(x,y) = s(x,y)\,e^{i\theta(x,y)}\,z(x,y)
$$

So the warp has the pointwise affine form

$$
w(x,y) = a(x,y)\,z(x,y) + b(x,y)
$$

with

$$
a(x,y) = s(x,y)\,e^{i\theta(x,y)}
$$

$$
b(x,y) = 0
$$

## 5. Real and imaginary parts of `a`

If you want to store each coefficient explicitly as two real numbers,

$$
a(x,y) = a_r(x,y) + i a_i(x,y)
$$

with

$$
a_r(x,y) = s(x,y)\cos\theta(x,y)
$$

$$
a_i(x,y) = s(x,y)\sin\theta(x,y)
$$

and

$$
b(x,y) = 0 + i0
$$

## 6. Interpreting this as a 2D array

If you want one pair of complex coefficients for each sample point $(x,y)$, define the 2D array

$$
T[x,y] = (a(x,y), b(x,y))
$$

where each entry contains:

- one complex multiplier $a(x,y)$
- one complex offset $b(x,y)$

For this specific shader warp,

$$
T[x,y] = \left(s(x,y)e^{i\theta(x,y)}, 0\right)
$$

## 7. Important remark

This is not one single global affine map valid for all points. It is a pointwise map because the coefficient $a(x,y)$ depends on the position through $|z(x,y)|$.

So the correct statement is:

$$
\forall (x,y), \quad w(x,y) = a(x,y)\,z(x,y) + b(x,y)
$$

with spatially varying coefficients.