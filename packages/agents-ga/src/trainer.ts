import { OnitamaEngine, stateHash, type Agent, type Player } from "@board-ai-lab/onitama-engine";
import { RandomAgent } from "@board-ai-lab/agents-random";
import { HeuristicAgent } from "./agent.js";
import { DEFAULT_WEIGHTS } from "./evaluator.js";
import { SeededRandom } from "./random.js";
import type { GenerationStat, Genome, HeuristicWeights, TrainingConfig, TrainingReplay, TrainingReplayTurn, TrainingResult } from "./types.js";

const engine = new OnitamaEngine();

const DEFAULT_CONFIG: TrainingConfig = {
  populationSize: 64,
  generations: 40,
  elitismCount: 6,
  tournamentSize: 4,
  crossoverRate: 0.7,
  mutationRate: 0.2,
  mutationScale: 0.35,
  gamesPerGenome: 8,
  searchDepth: 1,
  useRandomOpponents: true,
  usePeerOpponents: true,
  useChampionArchive: true,
  seed: 42
};

function opponent(player: Player): Player {
  return player === "red" ? "blue" : "red";
}

function createRandomWeights(rng: SeededRandom): HeuristicWeights {
  const randWeight = () => (rng.next() * 6) - 3;
  return {
    material: randWeight(),
    masterSafety: randWeight(),
    mobility: randWeight(),
    templePressure: randWeight(),
    captureThreat: randWeight(),
    centerControl: randWeight(),
    cardTempo: randWeight()
  };
}

function cloneGenome(genome: Genome): Genome {
  return {
    id: genome.id,
    fitness: genome.fitness,
    weights: { ...genome.weights }
  };
}

function crossover(a: HeuristicWeights, b: HeuristicWeights, rng: SeededRandom): HeuristicWeights {
  const mix = (x: number, y: number) => x * (1 - rng.next()) + y * rng.next();
  return {
    material: mix(a.material, b.material),
    masterSafety: mix(a.masterSafety, b.masterSafety),
    mobility: mix(a.mobility, b.mobility),
    templePressure: mix(a.templePressure, b.templePressure),
    captureThreat: mix(a.captureThreat, b.captureThreat),
    centerControl: mix(a.centerControl, b.centerControl),
    cardTempo: mix(a.cardTempo, b.cardTempo)
  };
}

function mutate(weights: HeuristicWeights, rng: SeededRandom, config: TrainingConfig): HeuristicWeights {
  const mutateField = (value: number) => {
    if (rng.next() > config.mutationRate) {
      return value;
    }
    const delta = (rng.next() * 2 - 1) * config.mutationScale;
    return Math.max(-5, Math.min(5, value + delta));
  };

  return {
    material: mutateField(weights.material),
    masterSafety: mutateField(weights.masterSafety),
    mobility: mutateField(weights.mobility),
    templePressure: mutateField(weights.templePressure),
    captureThreat: mutateField(weights.captureThreat),
    centerControl: mutateField(weights.centerControl),
    cardTempo: mutateField(weights.cardTempo)
  };
}

function tournamentSelect(population: Genome[], rng: SeededRandom, tournamentSize: number): Genome {
  let best = population[rng.int(0, population.length)] as Genome;
  for (let i = 1; i < tournamentSize; i += 1) {
    const candidate = population[rng.int(0, population.length)] as Genome;
    if (candidate.fitness > best.fitness) {
      best = candidate;
    }
  }
  return best;
}

function pushRecentGame(recentGames: TrainingReplay[], replay: TrainingReplay, limit = 10): void {
  recentGames.push(replay);
  if (recentGames.length > limit) {
    recentGames.splice(0, recentGames.length - limit);
  }
}

function playGame(
  redAgent: Agent,
  blueAgent: Agent,
  metadata: Omit<TrainingReplay, "winner" | "winReason" | "turns">,
  maxTurns = 120
): TrainingReplay {
  let state = engine.initialState({ seed: metadata.seed });
  const turns: TrainingReplayTurn[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (state.winner) {
      return {
        ...metadata,
        winner: state.winner,
        winReason: state.winReason,
        turns
      };
    }

    const legal = engine.legalMoves(state);
    if (legal.length === 0) {
      return {
        ...metadata,
        winner: opponent(state.currentPlayer),
        turns
      };
    }

    const actor = state.currentPlayer === "red" ? redAgent : blueAgent;
    const stateHashBefore = stateHash(state);
    const move = actor.selectMove(state, legal, { seed: turn });
    const nextState = engine.applyMove(state, move);

    turns.push({
      turn: state.turn,
      player: state.currentPlayer,
      move,
      stateHashBefore,
      stateHashAfter: stateHash(nextState)
    });

    state = nextState;
  }

  return {
    ...metadata,
    winner: state.winner,
    winReason: state.winReason,
    turns
  };
}

function evaluateGenome(
  weights: HeuristicWeights,
  config: TrainingConfig,
  seedOffset: number,
  generation: number,
  genomeId: string,
  recentGames: TrainingReplay[],
  peerPool: Genome[]
): number {
  const candidate = new HeuristicAgent(weights, config.searchDepth, "candidate");
  const previousChampion = config.previousChampionWeights
    ? new HeuristicAgent(config.previousChampionWeights, config.searchDepth, "previous-champion")
    : null;
  const championArchive = config.useChampionArchive
    ? (config.championArchiveWeights ?? []).map(
        (archiveWeights, idx) => new HeuristicAgent(archiveWeights, config.searchDepth, `archive-${idx}`)
      )
    : [];
  const peerOpponents = config.usePeerOpponents
    ? peerPool
        .filter((peer) => peer.id !== genomeId)
        .map((peer) => ({
          id: peer.id,
          agent: new HeuristicAgent(peer.weights, config.searchDepth, `peer-${peer.id}`)
        }))
    : [];
  let score = 0;
  const opponentModes = [
    ...(config.useRandomOpponents ? (["random"] as const) : []),
    ...(previousChampion ? ["previous-champion"] : []),
    ...(championArchive.length > 0 ? ["archive"] : []),
    ...(peerOpponents.length > 0 ? ["peer"] : [])
  ] as const;

  for (let i = 0; i < config.gamesPerGenome; i += 1) {
    const mode = opponentModes[i % opponentModes.length] ?? "previous-champion";
    let redOpponent: Agent;
    let blueOpponent: Agent;
    let opponentLabel: string;
    let reverseOpponentLabel: string;

    if (mode === "previous-champion" && previousChampion) {
      redOpponent = previousChampion;
      blueOpponent = previousChampion;
      opponentLabel = "previous-champion";
      reverseOpponentLabel = "previous-champion";
    } else if (mode === "archive" && championArchive.length > 0) {
      const archiveOpponent = championArchive[i % championArchive.length] as HeuristicAgent;
      redOpponent = archiveOpponent;
      blueOpponent = archiveOpponent;
      opponentLabel = archiveOpponent.name;
      reverseOpponentLabel = archiveOpponent.name;
    } else if (mode === "peer" && peerOpponents.length > 0) {
      const peerOpponent = peerOpponents[(seedOffset + i) % peerOpponents.length]!;
      redOpponent = peerOpponent.agent;
      blueOpponent = peerOpponent.agent;
      opponentLabel = peerOpponent.id;
      reverseOpponentLabel = peerOpponent.id;
    } else {
      redOpponent = new RandomAgent(`random-r-${i}`, seedOffset * 100 + i + 7);
      blueOpponent = new RandomAgent(`random-b-${i}`, seedOffset * 100 + i + 99);
      opponentLabel = `random-b-${i}`;
      reverseOpponentLabel = `random-r-${i}`;
    }

    const redSeed = seedOffset * 1000 + i * 2;
    const asRed = playGame(
      candidate,
      blueOpponent,
      {
        replayId: `${genomeId}-g${generation}-game-${i * 2}`,
        startedAtIso: new Date().toISOString(),
        seed: redSeed,
        generation,
        genomeId,
        gameIndex: i * 2,
        players: {
          red: genomeId,
          blue: opponentLabel
        }
      }
    );
    pushRecentGame(recentGames, asRed);
    if (asRed.winner === "red") score += 1;
    if (asRed.winner === undefined) score += 0.5;

    const blueSeed = seedOffset * 1000 + i * 2 + 1;
    const asBlue = playGame(
      redOpponent,
      candidate,
      {
        replayId: `${genomeId}-g${generation}-game-${i * 2 + 1}`,
        startedAtIso: new Date().toISOString(),
        seed: blueSeed,
        generation,
        genomeId,
        gameIndex: i * 2 + 1,
        players: {
          red: reverseOpponentLabel,
          blue: genomeId
        }
      }
    );
    pushRecentGame(recentGames, asBlue);
    if (asBlue.winner === "blue") score += 1;
    if (asBlue.winner === undefined) score += 0.5;
  }

  return score / (config.gamesPerGenome * 2);
}

export function trainHeuristic(
  inputConfig: Partial<TrainingConfig> = {},
  onGeneration?: (generation: number, population: Genome[]) => void
): TrainingResult {
  const config: TrainingConfig = { ...DEFAULT_CONFIG, ...inputConfig };
  const rng = new SeededRandom(config.seed);

  let population: Genome[] = Array.from({ length: config.populationSize }, (_, idx) => ({
    id: `g0-${idx}`,
    weights: idx === 0 ? { ...(config.initialWeights ?? DEFAULT_WEIGHTS) } : createRandomWeights(rng),
    fitness: 0
  }));

  const history: GenerationStat[] = [];
  const recentGames: TrainingReplay[] = [];
  let champion: Genome | undefined;

  for (let generation = 0; generation < config.generations; generation += 1) {
    const evaluationPool = population.map(cloneGenome);
    population = population.map((genome, idx) => ({
      ...genome,
      fitness: evaluateGenome(
        genome.weights,
        config,
        generation * 10_000 + idx,
        generation,
        genome.id,
        recentGames,
        evaluationPool
      )
    }));

    population.sort((a, b) => b.fitness - a.fitness);
    const bestFitness = population[0]?.fitness ?? 0;
    const meanFitness = population.reduce((sum, genome) => sum + genome.fitness, 0) / population.length;
    if (!champion || (population[0]?.fitness ?? -Infinity) > champion.fitness) {
      champion = cloneGenome(population[0] as Genome);
    }
    history.push({
      generation,
      bestFitness,
      meanFitness,
      bestWeights: { ...(population[0] as Genome).weights },
      championFitness: champion.fitness,
      championWeights: { ...champion.weights }
    });

    onGeneration?.(generation, population);

    const nextPopulation: Genome[] = population.slice(0, config.elitismCount).map(cloneGenome);

    while (nextPopulation.length < config.populationSize) {
      const parentA = tournamentSelect(population, rng, config.tournamentSize);
      const parentB = tournamentSelect(population, rng, config.tournamentSize);

      let childWeights = { ...parentA.weights };
      if (rng.next() < config.crossoverRate) {
        childWeights = crossover(parentA.weights, parentB.weights, rng);
      }
      childWeights = mutate(childWeights, rng, config);

      nextPopulation.push({
        id: `g${generation + 1}-${nextPopulation.length}`,
        weights: childWeights,
        fitness: 0
      });
    }

    population = nextPopulation;
  }

  const finalEvaluationPool = population.map(cloneGenome);
  population = population.map((genome, idx) => ({
    ...genome,
    fitness: evaluateGenome(
      genome.weights,
      config,
      900_000 + idx,
      config.generations,
      genome.id,
      recentGames,
      finalEvaluationPool
    )
  }));
  population.sort((a, b) => b.fitness - a.fitness);
  if (!champion || (population[0]?.fitness ?? -Infinity) > champion.fitness) {
    champion = cloneGenome(population[0] as Genome);
  }

  return {
    bestGenome: champion,
    history,
    recentGames
  };
}
