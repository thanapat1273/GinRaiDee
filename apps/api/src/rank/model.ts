// Linear Thompson sampling (Russo et al. tutorial; Chapelle & Li 2011), one model per user.
// Posterior over weights θ:  mean = A⁻¹ b,  covariance = v² A⁻¹.
// Start: A = λI, b = λ·μ0 so the mean equals the hand-set prior until data arrives.
import { one, query } from "../db.ts";
import { DIM, priorVector } from "./features.ts";
import { cholesky, dot, identity, randn, solveLowerT, solveUpper } from "./linalg.ts";

export const MODEL_POLICY = "lints-v1";
const LAMBDA = 3;    // prior strength, in "observations"
const V = 0.35;      // exploration scale: how wide each posterior draw is

export class LinTS {
  constructor(public A: number[][], public b: number[], public n = 0) {}

  static fresh(): LinTS {
    return new LinTS(identity(DIM, LAMBDA), priorVector().map((x) => LAMBDA * x));
  }

  /** Posterior mean and one sample, sharing one Cholesky factorisation. */
  draw(samples = 1): { mean: number[]; thetas: number[][] } {
    const R = cholesky(this.A);
    const mean = solveUpper(R, solveLowerT(R, this.b));
    const thetas: number[][] = [];
    for (let s = 0; s < samples; s++) {
      // θ = mean + V · R⁻¹ z  has covariance V² (RᵀR)⁻¹ = V² A⁻¹
      const z = Array.from({ length: DIM }, randn);
      const w = solveUpper(R, z);
      thetas.push(mean.map((m, i) => m + V * w[i]!));
    }
    return { mean, thetas };
  }

  update(phi: number[], reward: number, weight = 1) {
    for (let i = 0; i < DIM; i++) {
      this.b[i]! += weight * reward * phi[i]!;
      for (let j = 0; j < DIM; j++) this.A[i]![j]! += weight * phi[i]! * phi[j]!;
    }
    this.n++;
  }

  predict(theta: number[], phi: number[]) {
    return dot(theta, phi);
  }
}

export async function loadModel(userId: string): Promise<LinTS> {
  const row = await one<{ a: number[][]; b: number[]; n: number }>(
    "SELECT a, b, n FROM user_model WHERE user_id = $1 AND policy = $2", [userId, MODEL_POLICY]);
  if (!row || row.b.length !== DIM) return LinTS.fresh(); // feature list changed → start over
  return new LinTS(row.a, row.b, row.n);
}

export async function saveModel(userId: string, m: LinTS) {
  await query(
    `INSERT INTO user_model (user_id, policy, a, b, n) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, policy) DO UPDATE SET a = $3, b = $4, n = $5, updated_at = now()`,
    [userId, MODEL_POLICY, JSON.stringify(m.A), JSON.stringify(m.b), m.n]);
}
