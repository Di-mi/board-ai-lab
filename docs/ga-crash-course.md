# GA Crash Course for This Project

## 1) Why genetic algorithms here
We are not training a neural network. We are tuning a heuristic evaluator for Onitama. Genetic algorithms (GA) are a good fit because we can score candidate heuristics by match results without needing gradient-based optimization.

## 2) Core terminology
- Genome: one candidate parameter vector (our weight set).
- Gene: one number inside the genome (one weight).
- Population: all genomes in one generation.
- Fitness: performance score for a genome.
- Selection: choosing genomes that reproduce.
- Crossover: mixing two parent genomes.
- Mutation: random adjustments to genes.
- Elitism: keeping top genomes unchanged each generation.
- Generation: one full evaluate->select->reproduce cycle.

## 3) What weights control in our bot
Our evaluator computes:

`score = w1*f_material + w2*f_masterSafety + w3*f_mobility + w4*f_templePressure + w5*f_captureThreat + w6*f_centerControl + w7*f_cardTempo`

Features:
- `f_material`: student piece advantage.
- `f_masterSafety`: own master threat pressure vs opponent master threat pressure.
- `f_mobility`: legal move count advantage.
- `f_templePressure`: progress of your master toward temple arch victory.
- `f_captureThreat`: count of immediate capturing opportunities minus opponent's.
- `f_centerControl`: occupation of central 3x3 area.
- `f_cardTempo`: short-term move optionality from current card cycle.

Interpretation:
- Positive weight means the bot prefers positions where that feature is high.
- Negative weight means the bot avoids that feature.
- Larger magnitude means stronger influence on decision-making.

## 4) What genomes are actually changing
Genome schema:

```json
{
  "material": 1.2,
  "masterSafety": 2.1,
  "mobility": 0.3,
  "templePressure": 0.8,
  "captureThreat": 1.5,
  "centerControl": -0.2,
  "cardTempo": 0.6
}
```

GA changes only these numbers. It does not change game rules, legal move generation, or search depth.

Behavior examples:
- Increase `captureThreat` -> bot becomes tactically aggressive.
- Increase `masterSafety` -> bot becomes conservative/defensive.
- Increase `templePressure` -> bot pushes temple-arch plans earlier.
- Decrease `mobility` (or make negative) -> bot may prefer locked positions.

## 5) Fitness definition in this repo
Each genome is evaluated by playing games against random baselines as both colors.

Current scoring:
- win = 1.0
- draw = 0.5
- loss = 0.0

Fitness = average score across evaluation games.

## 6) Selection, crossover, mutation in this implementation
- Selection: tournament selection.
- Crossover: arithmetic mix between two parent weight vectors.
- Mutation: per-gene random delta with bounded range.
- Elitism: top genomes copied unchanged to next generation.

## 7) Typical GA failure modes
- Noisy fitness from too few games.
- Premature convergence (population too similar too quickly).
- Overfitting to one weak baseline.
- Weight explosion (mitigated by clamping).

## 8) How to read training outputs
`artifacts/training/<run-id>/` contains:
- `checkpoint-gN.json`: best genome snapshot per generation.
- `best-genome.json`: best final genome.
- `history.json`: generation-level best/mean fitness trend.

Quick interpretation:
- Rising best + rising mean: stable improvement.
- Rising best + flat mean: one strong outlier, weak population diversity.
- Flat both: either search stagnation or insufficient fitness signal.

## 9) How this connects to your workflow
1. You play against random bot first to validate rules/UI.
2. Run GA training.
3. Load `best-genome.json` into playground and play against trained bot.
4. Only then move to LLM benchmark stage.
