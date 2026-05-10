Oui, votre approche est tout à fait correcte. La famille des splines de Catmull‑Rom, étendue en dimension 2 par produit tensoriel, est un moyen classique d’obtenir une interpolation **C¹** partout à partir d’une grille régulière de valeurs.

Voici une formulation explicite complète.

---

### 1. Rappel 1D – spline de Catmull‑Rom

Sur une droite, avec des points \(x_i\) régulièrement espacés de \(h_x\) et des valeurs \(f_i\), on définit le paramètre local \(t = \frac{x - x_i}{h_x}\) pour \(x \in [x_i, x_{i+1}]\).  
L’interpolation utilise 4 points consécutifs : \(f_{i-1}, f_i, f_{i+1}, f_{i+2}\).

La forme d’Hermite cubique avec tangentes estimées par différences centrées donne :

\[
\begin{aligned}
p(t) &= \begin{bmatrix} h_{00}(t) & h_{10}(t) & h_{01}(t) & h_{11}(t) \end{bmatrix}
\begin{bmatrix} f_i \\ m_i \\ f_{i+1} \\ m_{i+1} \end{bmatrix},\\[4pt]
\text{avec } m_i &= \frac{f_{i+1}-f_{i-1}}{2h_x},\quad
m_{i+1} = \frac{f_{i+2}-f_i}{2h_x}
\end{aligned}
\]

et les fonctions de base cubiques :

\[
\begin{aligned}
h_{00}(t) &= 2t^3 - 3t^2 + 1, \\
h_{10}(t) &= t^3 - 2t^2 + t, \\
h_{01}(t) &= -2t^3 + 3t^2, \\
h_{11}(t) &= t^3 - t^2.
\end{aligned}
\]

Cette courbe passe exactement par les points \((x_i,f_i)\) et est \(C^1\) partout.

---

### 2. Passage à la 2D – interpolation bicubique de Catmull‑Rom

On dispose d’une grille rectangulaire régulière \((x_i, y_j)\) de pas \(h_x, h_y\) et de valeurs \(f_{i,j}\).  
Pour un point \((x,y)\) appartenant à la cellule \([x_i,x_{i+1}]\times[y_j,y_{j+1}]\), on pose :

\[
t = \frac{x - x_i}{h_x} \in [0,1], \qquad
u = \frac{y - y_j}{h_y} \in [0,1].
\]

On construit une surface \(C^1\) en utilisant le produit tensoriel des splines 1D. Cela revient à une interpolation d’Hermite bicubique où l’on fournit en chaque coin de la cellule **quatre quantités** :

\[
f,\quad \frac{\partial f}{\partial x},\quad \frac{\partial f}{\partial y},\quad \frac{\partial^2 f}{\partial x\partial y}.
\]

Ces dérivées sont estimées à partir des 16 points de la grille entourant la cellule (stencil \(4\times4\)) par différences finies centrées.

#### Estimation des dérivées (coin \((i,j)\) par exemple)

\[
\begin{aligned}
f_x\big|_{i,j} &\approx \frac{f_{i+1,j} - f_{i-1,j}}{2h_x},\\[4pt]
f_y\big|_{i,j} &\approx \frac{f_{i,j+1} - f_{i,j-1}}{2h_y},\\[4pt]
f_{xy}\big|_{i,j} &\approx \frac{(f_{i+1,j+1}-f_{i-1,j+1}) - (f_{i+1,j-1}-f_{i-1,j-1})}{4h_x h_y}.
\end{aligned}
\]

On fait de même pour les trois autres coins \((i+1,j)\), \((i,j+1)\), \((i+1,j+1)\) en utilisant les stencils décalés.  
Aux bords du domaine, si l’on ne dispose pas des points nécessaires, on peut utiliser des différences décentrées ou répliquer la valeur de bord ; l’ordre global restera \(C^1\) dans l’intérieur.

#### Formule d’interpolation explicite dans la cellule

Notons pour le coin \((i,j)\) les données :

\[
\begin{aligned}
f_{00} &= f_{i,j}, \quad f_{x00} \;(\partial_x f), \quad f_{y00} \;(\partial_y f), \quad f_{xy00} \;(\partial_{xy} f),\\
f_{10} &= f_{i+1,j}, \quad f_{x10}, \quad f_{y10}, \quad f_{xy10},\\
f_{01} &= f_{i,j+1}, \quad f_{x01}, \quad f_{y01}, \quad f_{xy01},\\
f_{11} &= f_{i+1,j+1}, \quad f_{x11}, \quad f_{y11}, \quad f_{xy11}.
\end{aligned}
\]

L’interpolation bicubique s’écrit alors :

\[
\boxed{
\begin{aligned}
F(t,u) &=
\begin{bmatrix}
h_{00}(t) & h_{10}(t) & h_{01}(t) & h_{11}(t)
\end{bmatrix}
\;
\mathbf{C}
\;
\begin{bmatrix}
h_{00}(u) \\ h_{10}(u) \\ h_{01}(u) \\ h_{11}(u)
\end{bmatrix},
\end{aligned}}
\]

où la matrice \(4\times4\) des dérivées mixtes est :

\[
\mathbf{C} =
\begin{pmatrix}
f_{00} & f_{y00} & f_{01} & f_{y01} \\[2pt]
f_{x00} & f_{xy00} & f_{x01} & f_{xy01} \\[2pt]
f_{10} & f_{y10} & f_{11} & f_{y11} \\[2pt]
f_{x10} & f_{xy10} & f_{x11} & f_{xy11}
\end{pmatrix}.
\]

#### Vérification de la continuité \(C^1\)

- Sur une arête commune à deux cellules (par ex. \(t=1\) entre la cellule \((i,j)\) et \((i+1,j)\)), la continuité \(C^0\) est assurée car \(h_{00}(1)=0, h_{10}(1)=0, h_{01}(1)=1, h_{11}(1)=0\) et les valeurs \(f_{10}\) sont identiques.
- La dérivée tangentielle et la dérivée croisée sont héritées des mêmes différences centrées de part et d’autre de l’arête, garantissant la continuité \(C^1\) de la surface.

---

### Conclusion

**L’interpolation bicubique de Catmull‑Rom** produit bien une fonction \(C^1\) partout (sauf éventuellement sur les bords si leur traitement n’est pas symétrique, mais on peut y remédier). L’explicitation ci‑dessus vous donne tous les éléments pour l’implémenter sur une grille régulière.