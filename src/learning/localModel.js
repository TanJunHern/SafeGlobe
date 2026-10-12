/**
 * The offline review model: gradient-boosted decision trees trained inside the app, used when BigQuery ML is
 * not connected. It is a real, small supervised model, so the whole loop (label, train, tune, predict, explain)
 * works offline. It is labelled "Offline model" wherever it is used. BigQuery ML trains its own boosted trees
 * with the same kind of settings (bqModel.js).
 *
 *   split      70% training, 15% validation (to pick the settings), 15% test (to report how good it is)
 *   tuning     a few trials over tree depth and learning rate; the best validation AUC wins
 *   predict    probability that a compliance officer would mark the case as real risk
 *   explain    how much each feature moved this prediction, added up along the path taken through every tree
 */
const { FEATURES } = require('./features');
const { rng } = require('./syntheticReviews');

const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const TRIALS = [
  { max_tree_depth: 2, learn_rate: 0.1 }, { max_tree_depth: 2, learn_rate: 0.3 }, { max_tree_depth: 3, learn_rate: 0.1 },
  { max_tree_depth: 3, learn_rate: 0.3 }, { max_tree_depth: 4, learn_rate: 0.1 }, { max_tree_depth: 4, learn_rate: 0.2 }
];
const MAX_ITERATIONS = 60;
const L2_REG = 2.0;
const MIN_CHILD = 12;

/** Columns the model is trained on: the numbers as they are, and one column per value of each category. */
const COLUMNS = FEATURES.flatMap(f => (f.categorical ? f.categorical.map(v => ({ name: `${f.name}=${v}`, feature: f.name, value: v })) : [{ name: f.name, feature: f.name }]));
const vector = features => COLUMNS.map(c => (c.value !== undefined ? (features[c.feature] === c.value ? 1 : 0) : Number(features[c.feature]) || 0));

/** One tree, grown on the gradients of the log loss (the way XGBoost does). Every node keeps its own value. */
function growTree(X, g, h, rows, depth, maxDepth) {
  let G = 0, H = 0;
  for (const i of rows) { G += g[i]; H += h[i]; }
  const node = { value: -G / (H + L2_REG) };
  if (depth >= maxDepth || rows.length < MIN_CHILD * 2) return node;
  let best = null;
  for (let j = 0; j < COLUMNS.length; j++) {
    const sorted = rows.slice().sort((a, b) => X[a][j] - X[b][j]);
    let GL = 0, HL = 0;
    for (let k = 0; k < sorted.length - 1; k++) {
      GL += g[sorted[k]]; HL += h[sorted[k]];
      const v = X[sorted[k]][j], next = X[sorted[k + 1]][j];
      if (v === next || k + 1 < MIN_CHILD || sorted.length - k - 1 < MIN_CHILD) continue;
      const gain = (GL * GL) / (HL + L2_REG) + ((G - GL) * (G - GL)) / (H - HL + L2_REG) - (G * G) / (H + L2_REG);
      if (!best || gain > best.gain) best = { gain, j, threshold: (v + next) / 2 };
    }
  }
  if (!best || best.gain < 1e-6) return node;
  node.column = best.j;
  node.threshold = best.threshold;
  node.left = growTree(X, g, h, rows.filter(i => X[i][best.j] <= best.threshold), depth + 1, maxDepth);
  node.right = growTree(X, g, h, rows.filter(i => X[i][best.j] > best.threshold), depth + 1, maxDepth);
  return node;
}
const leafOf = (node, x) => { while (node.column !== undefined) node = x[node.column] <= node.threshold ? node.left : node.right; return node.value; };

function fit(X, y, { max_tree_depth, learn_rate, iterations = MAX_ITERATIONS }, weights = null) {
  const n = X.length;
  const wt = weights || new Array(n).fill(1);
  const base = Math.log((y.reduce((a, b) => a + b, 0) + 1) / (n - y.reduce((a, b) => a + b, 0) + 1));
  const z = new Array(n).fill(base);
  const rows = X.map((_, i) => i);
  const trees = [];
  for (let it = 0; it < iterations; it++) {
    // A row's weight scales how much it pulls on the trees: an officer's own review counts for more than a synthetic one
    const g = z.map((zi, i) => wt[i] * (sigmoid(zi) - y[i]));
    const h = z.map((zi, i) => { const p = sigmoid(zi); return wt[i] * Math.max(p * (1 - p), 1e-6); });
    const tree = growTree(X, g, h, rows, 0, max_tree_depth);
    trees.push(tree);
    for (let i = 0; i < n; i++) z[i] += learn_rate * leafOf(tree, X[i]);
  }
  return { base, learn_rate, trees };
}
const score = (m, x) => sigmoid(m.base + m.learn_rate * m.trees.reduce((s, t) => s + leafOf(t, x), 0));

/** Area under the ROC curve: the chance that a real-risk case gets a higher prediction than a no-risk case. */
function auc(probs, y) {
  const pos = [], neg = [];
  probs.forEach((p, i) => (y[i] ? pos : neg).push(p));
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function metricsAt(probs, y, threshold) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  probs.forEach((p, i) => { const said = p >= threshold; if (said && y[i]) tp++; else if (said && !y[i]) fp++; else if (!said && y[i]) fn++; else tn++; });
  const r = v => (v === null ? null : Math.round(v * 1000) / 1000);
  return { threshold, rows: y.length, true_positives: tp, false_positives: fp, true_negatives: tn, false_negatives: fn,
    precision: r(tp + fp ? tp / (tp + fp) : null), recall: r(tp + fn ? tp / (tp + fn) : null), accuracy: r(y.length ? (tp + tn) / y.length : null) };
}

/**
 * Trains on labelled rows [{ features, label: 'risk' | 'no_risk' }].
 * Returns the model with its tuning trials, its test metrics, and "missed risk": of the test cases an officer
 * marked as real risk although the rules scored them below the line, how many the model would have flagged.
 */
function train(rows, { threshold = 0.5, riskLine = 50, seed = 7, isHoldout = null } = {}) {
  if (rows.length < 40) throw Object.assign(new Error(`At least 40 labelled reviews are needed to train; there are ${rows.length}.`), { status: 400 });
  const y = rows.map(r => (r.label === 'risk' ? 1 : 0));
  if (new Set(y).size < 2) throw Object.assign(new Error('The labelled reviews are all the same colour. Both red and green examples are needed.'), { status: 400 });
  const X = rows.map(r => vector(r.features));

  // The test rows are fixed by the caller (the same reviews are held back every time, so one model can be compared
  // with the next). The rest is shuffled the same way every time and split into training and validation.
  const all = rows.map((_, i) => i);
  const held = isHoldout ? all.filter(i => isHoldout(rows[i])) : [];
  const order = isHoldout ? all.filter(i => !isHoldout(rows[i])) : all;
  const rand = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const nTrain = Math.floor(order.length * (isHoldout ? 0.82 : 0.7)), nVal = isHoldout ? order.length - nTrain : Math.floor(order.length * 0.15);
  const take = idx => ({ X: idx.map(i => X[i]), y: idx.map(i => y[i]), w: idx.map(i => Number(rows[i].weight) || 1), idx });
  const tr = take(order.slice(0, nTrain)), va = take(order.slice(nTrain, nTrain + nVal)), te = take(isHoldout ? held : order.slice(nTrain + nVal));

  const trials = TRIALS.map((params, i) => {
    const m = fit(tr.X, tr.y, params, tr.w);
    const a = auc(va.X.map(x => score(m, x)), va.y);
    return { trial_id: i + 1, hyperparameters: params, roc_auc: a === null ? null : Math.round(a * 1000) / 1000, is_optimal: false, m };
  });
  const best = trials.reduce((a, t) => ((t.roc_auc || 0) > (a.roc_auc || 0) ? t : a), trials[0]);
  best.is_optimal = true;
  const probs = te.X.map(x => score(best.m, x));
  const test = Object.assign(metricsAt(probs, te.y, threshold), { roc_auc: (v => (v === null ? null : Math.round(v * 1000) / 1000))(auc(probs, te.y)) });
  // The misses the model is for: an officer said "real risk" and the rules scored it below the line
  const missed = te.idx.map((i, k) => ({ i, p: probs[k] })).filter(({ i }) => y[i] === 1 && rows[i].features.rule_risk < riskLine);
  const model = { type: 'boosted_trees', columns: COLUMNS.map(c => c.name), base: best.m.base, learn_rate: best.m.learn_rate, trees: best.m.trees, threshold };
  return {
    model,
    trials: trials.map(({ m, ...t }) => t),
    best: { trial_id: best.trial_id, hyperparameters: best.hyperparameters },
    split: { training: tr.y.length, validation: va.y.length, test: te.y.length },
    metrics: Object.assign(test, { missed_by_rules: missed.length, missed_caught_by_model: missed.filter(m => m.p >= threshold).length })
  };
}

/** { p: probability an officer would mark it real risk, reasons: [{ feature, attribution }] strongest first } */
function predict(model, features, topK = 4) {
  const x = vector(features);
  const byFeature = new Map();
  let z = model.base;
  for (const tree of model.trees) {
    // Along the path, each split moves the tree's answer; that move is credited to the feature that was split on
    let node = tree;
    while (node.column !== undefined) {
      const next = x[node.column] <= node.threshold ? node.left : node.right;
      const feature = COLUMNS[node.column].feature;
      byFeature.set(feature, (byFeature.get(feature) || 0) + model.learn_rate * (next.value - node.value));
      node = next;
    }
    z += model.learn_rate * node.value;
  }
  const reasons = [...byFeature].map(([feature, attribution]) => ({ feature, attribution: Math.round(attribution * 1000) / 1000 }))
    .filter(r => Math.abs(r.attribution) > 0.01).sort((a, b) => Math.abs(b.attribution) - Math.abs(a.attribution)).slice(0, topK);
  return { p: Math.round(sigmoid(z) * 1000) / 1000, reasons };
}

module.exports = { train, predict, auc, metricsAt, COLUMNS, TRIALS };
