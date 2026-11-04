// Just enough linear algebra for a ~24-dimensional Bayesian linear model.

export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export function identity(n: number, scale = 1): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? scale : 0)));
}

/** Upper-triangular R with A = Rᵀ R (A symmetric positive definite). */
export function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const R = identity(n, 0);
  for (let j = 0; j < n; j++) {
    let s = A[j]![j]!;
    for (let k = 0; k < j; k++) s -= R[k]![j]! ** 2;
    const rjj = Math.sqrt(Math.max(s, 1e-12));
    R[j]![j] = rjj;
    for (let i = j + 1; i < n; i++) {
      let t = A[j]![i]!;
      for (let k = 0; k < j; k++) t -= R[k]![j]! * R[k]![i]!;
      R[j]![i] = t / rjj;
    }
  }
  return R;
}

/** Solve Rᵀ y = b (forward), R upper-triangular. */
export function solveLowerT(R: number[][], b: number[]): number[] {
  const n = b.length, y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= R[k]![i]! * y[k]!;
    y[i] = s / R[i]![i]!;
  }
  return y;
}

/** Solve R x = y (backward), R upper-triangular. */
export function solveUpper(R: number[][], y: number[]): number[] {
  const n = y.length, x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= R[i]![k]! * x[k]!;
    x[i] = s / R[i]![i]!;
  }
  return x;
}

/** Standard normal via Box–Muller. */
export function randn(): number {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
