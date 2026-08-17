// ─────────────────────────────────────────────────────────────
// Phase 18 §4 / Phase 19 §3 — HALUCINATE scenario/assumption mode, pure
// math only. 100% client-side/in-memory — this module never calls any
// API and never mutates real Product/Expense/ProfitSettings data. It only
// reads an already-fetched profitability payload (Overview's /summary,
// or Campaigns'/Daily's own `totals` field — see wrapRollupAsScenarioData
// below for why those need a small adapter) and substitutes user-typed
// override values into the SAME formula server/routes/profitability.js's
// rollupOrders() uses:
//
//   totalRecognizedRevenue = prepaidRevenue + codRevenue * (codRate/100)
//   totalProductExpense    = productCost + packagingCost + shippingCost + otherCost
//   totalExpenses          = advertisingExpense + totalProductExpense + operatingExpense
//   netProfit              = totalRecognizedRevenue - totalExpenses
//   profitMargin           = totalRecognizedRevenue ? netProfit / totalRecognizedRevenue * 100 : 0
//
// Phase 19 §3 extends the original Phase 18 "one flat number per
// category" design with:
//   1. Per-expense overrides for Operating Expenses, keyed by expenseId,
//      ALONGSIDE (not instead of) the original single lump "Operating
//      Expenses (total)" override — see computeOperatingExpense()'s
//      comment below for exactly how the two combine when both are set.
//   2. buildScenarioRatios()/applyScenarioToRow() — a reusable way to
//      apply the SAME scenario to any OTHER already-fetched rollup-shaped
//      object (a single campaign row from /campaigns, a single day row
//      from /daily), not just the overall aggregate, so HALUCINATE can
//      propagate to the Campaigns/Daily tabs without re-fetching or
//      re-running the real per-order cost engine for every row.
//
// Every override still defaults to "" (unset/"use actual"), and nothing
// in this file — or anything that calls it — ever fires a save/update/
// create/POST/PUT request. (Verified: grepped this whole module and every
// caller for update/create/save/mutate/axios.post|put|patch calls —
// there are none.)
// ─────────────────────────────────────────────────────────────

export const emptyScenario = {
  productCost: "",
  packagingCost: "",
  shippingCost: "",
  otherCost: "",
  metaSpendMode: "flat", // "flat" (₹ total) | "percent" (% adjustment vs actual)
  metaSpend: "",
  metaSpendPercent: "",
  // Lump "override everything at once" shortcut — wins outright over any
  // per-expense override below when set (see computeOperatingExpense()).
  operatingExpense: "",
  // Phase 19 §3.1 — per-expense overrides, keyed by the real Expense
  // document's _id (operatingExpenseBreakdown[].expenseId, present on the
  // /summary response and on /campaigns|/daily's `totals` field). A
  // missing/"" entry for a given expenseId means "use that expense's own
  // actual allocated amount for this range".
  operatingExpenseByExpenseId: {},
  codRate: "",
};

function hasAnyOverrideValue(map) {
  if (!map) return false;
  return Object.values(map).some((v) => v !== "" && v !== null && v !== undefined);
}

// HALUCINATE activates the instant ANY field holds a value — per §12,
// "the act of changing a value IS what turns it on", not a separate
// manual toggle.
export function isScenarioActive(scenario) {
  if (!scenario) return false;
  return (
    scenario.productCost !== "" ||
    scenario.packagingCost !== "" ||
    scenario.shippingCost !== "" ||
    scenario.otherCost !== "" ||
    scenario.operatingExpense !== "" ||
    hasAnyOverrideValue(scenario.operatingExpenseByExpenseId) ||
    scenario.codRate !== "" ||
    (scenario.metaSpendMode === "flat" && scenario.metaSpend !== "") ||
    (scenario.metaSpendMode === "percent" && scenario.metaSpendPercent !== "")
  );
}

function overrideOr(raw, actual) {
  if (raw === "" || raw === null || raw === undefined) return actual;
  const n = Number(raw);
  return isNaN(n) ? actual : n;
}

function isSetOverride(raw) {
  return raw !== "" && raw !== null && raw !== undefined && !isNaN(Number(raw));
}

// Phase 19 §3.1 — builds the per-expense-row scenario view: each row of
// expenses.operatingExpenseBreakdown paired with its resolved scenario
// value (per-expense override if set, else that row's own actual) and
// whether it's actually "in effect" right now. When `lumpWon` is true (the
// single lump "Operating Expenses (total)" override is set), every row's
// scenario value collapses back to its actual — the lump is an explicit
// "ignore individual expenses" instruction — but the rows are still
// returned (with overridden:false) so the Scenario Summary/inputs can
// still show them, just not counted as active overrides.
function breakdownRows(scenario, expenses, lumpWon) {
  const overrides = scenario.operatingExpenseByExpenseId || {};
  return (expenses.operatingExpenseBreakdown || []).map((row) => {
    const raw = overrides[row.expenseId];
    const overridden = isSetOverride(raw) && !lumpWon;
    const scenarioVal = lumpWon ? row.amount : Math.max(0, overrideOr(raw, row.amount));
    return {
      expenseId: row.expenseId,
      name: row.name,
      category: row.category,
      actual: row.amount,
      scenario: round2(scenarioVal),
      overridden,
    };
  });
}

// Phase 19 §3.1 — sum of (per-expense override if set, else actual)
// across every row of operatingExpenseBreakdown, UNLESS the lump
// "Operating Expenses (total)" override is also set, in which case the
// lump wins OUTRIGHT (design decision — the simplest, least-surprising
// rule when both are present: a lump override reads as "ignore every
// individual expense, just use this one number for the whole category").
// Falls back to the plain actual total if no breakdown rows are available
// at all (defensive — every current caller always has at least an empty
// array).
function computeOperatingExpense(scenario, expenses) {
  if (isSetOverride(scenario.operatingExpense)) {
    return { operatingExpense: Math.max(0, Number(scenario.operatingExpense)), rows: breakdownRows(scenario, expenses, true) };
  }
  const breakdown = expenses.operatingExpenseBreakdown || [];
  if (breakdown.length === 0) {
    return { operatingExpense: Math.max(0, expenses.operatingExpense || 0), rows: [] };
  }
  const rows = breakdownRows(scenario, expenses, false);
  const operatingExpense = rows.reduce((sum, r) => sum + r.scenario, 0);
  return { operatingExpense, rows };
}

// data: a scenario-shaped payload — either the /summary response
// directly, or wrapRollupAsScenarioData(totals, codSuccessRate) applied
// to /campaigns or /daily's `totals` field. scenario: the override state
// above. Returns null if data isn't loaded yet.
export function computeScenario(data, scenario) {
  if (!data) return null;
  const { revenue, expenses, result } = data;

  const codRate = Math.min(100, Math.max(0, overrideOr(scenario.codRate, data.codSuccessRate)));
  const recognizedCodRevenue = revenue.codRevenue * (codRate / 100);
  const totalRecognizedRevenue = revenue.prepaidRevenue + recognizedCodRevenue;

  const productCost = Math.max(0, overrideOr(scenario.productCost, expenses.productCost));
  const packagingCost = Math.max(0, overrideOr(scenario.packagingCost, expenses.packagingCost));
  const shippingCost = Math.max(0, overrideOr(scenario.shippingCost, expenses.shippingCost));
  const otherCost = Math.max(0, overrideOr(scenario.otherCost, expenses.otherCost));
  const totalProductExpense = productCost + packagingCost + shippingCost + otherCost;

  let advertisingExpense = expenses.advertisingExpense;
  if (scenario.metaSpendMode === "percent" && scenario.metaSpendPercent !== "") {
    const pct = Number(scenario.metaSpendPercent);
    if (!isNaN(pct)) advertisingExpense = expenses.advertisingExpense * (1 + pct / 100);
  } else if (scenario.metaSpendMode === "flat") {
    advertisingExpense = overrideOr(scenario.metaSpend, expenses.advertisingExpense);
  }
  advertisingExpense = Math.max(0, advertisingExpense);

  const { operatingExpense, rows: operatingExpenseRows } = computeOperatingExpense(scenario, expenses);
  const lumpOperatingExpenseOverridden = isSetOverride(scenario.operatingExpense);

  const totalExpenses = advertisingExpense + totalProductExpense + operatingExpense;
  const netProfit = totalRecognizedRevenue - totalExpenses;
  const profitMargin = totalRecognizedRevenue ? (netProfit / totalRecognizedRevenue) * 100 : 0;

  return {
    codRate,
    recognizedCodRevenue: round2(recognizedCodRevenue),
    totalRecognizedRevenue: round2(totalRecognizedRevenue),
    productCost: round2(productCost),
    packagingCost: round2(packagingCost),
    shippingCost: round2(shippingCost),
    otherCost: round2(otherCost),
    totalProductExpense: round2(totalProductExpense),
    advertisingExpense: round2(advertisingExpense),
    operatingExpense: round2(operatingExpense),
    // Phase 19 §3.1/§3.4 — per-expense resolved rows (for the "override
    // individually" inputs and the Scenario Summary list) and whether the
    // lump override is the one currently winning.
    operatingExpenseRows,
    lumpOperatingExpenseOverridden,
    totalExpenses: round2(totalExpenses),
    netProfit: round2(netProfit),
    profitMargin: round2(profitMargin),
    improvement: round2(netProfit - (result?.netProfit || 0)),
  };
}

// Phase 19 §3.5 — wraps a flat rollupOrders()-shaped object (what
// /campaigns and /daily's `totals` field already are) into the
// { revenue, expenses, result } shape computeScenario() expects, so the
// exact same function/formula is reused for those endpoints' aggregate
// totals instead of a second implementation.
export function wrapRollupAsScenarioData(totals, codSuccessRate) {
  if (!totals) return null;
  return {
    codSuccessRate,
    revenue: {
      prepaidRevenue: totals.prepaidRevenue || 0,
      codRevenue: totals.codRevenue || 0,
    },
    expenses: {
      productCost: totals.productCost || 0,
      packagingCost: totals.packagingCost || 0,
      shippingCost: totals.shippingCost || 0,
      otherCost: totals.otherCost || 0,
      advertisingExpense: totals.spend || 0,
      operatingExpense: totals.operatingExpense || 0,
      operatingExpenseBreakdown: totals.operatingExpenseBreakdown || [],
    },
    result: {
      netProfit: totals.netProfit || 0,
    },
  };
}

// Phase 19 §3.5 — the overall scenario-vs-actual RATIO per cost/revenue
// category, derived once from range-wide totals. Applying this same ratio
// to any individual row's own actual figures is a defensible proportional
// approximation of "what would this row look like under the same
// assumptions", without re-running the real per-order cost engine per row
// (that would need a per-row re-fetch — campaign/day splits aren't in
// this payload). Falls back to a 1x (no-op) ratio when the overall actual
// for that category is 0, since there's no baseline to scale from.
export function buildScenarioRatios(scenarioData, scenario) {
  if (!scenarioData) return null;
  const result = computeScenario(scenarioData, scenario);
  if (!result) return null;
  const ratioOf = (scenarioVal, actualVal) => (actualVal ? scenarioVal / actualVal : 1);
  return {
    codRate: result.codRate, // an absolute % — applied directly per row, not scaled
    productCost: ratioOf(result.productCost, scenarioData.expenses.productCost),
    packagingCost: ratioOf(result.packagingCost, scenarioData.expenses.packagingCost),
    shippingCost: ratioOf(result.shippingCost, scenarioData.expenses.shippingCost),
    otherCost: ratioOf(result.otherCost, scenarioData.expenses.otherCost),
    advertisingExpense: ratioOf(result.advertisingExpense, scenarioData.expenses.advertisingExpense),
    operatingExpense: ratioOf(result.operatingExpense, scenarioData.expenses.operatingExpense),
  };
}

// Phase 19 §3.5 — applies buildScenarioRatios()'s output to ONE other
// rollupOrders()-shaped row (a single campaign row from /campaigns, a
// single day row from /daily — both already carry prepaidRevenue/
// codRevenue/productCost/packagingCost/shippingCost/otherCost/spend/
// operatingExpense, the exact fields this needs) and recomputes that
// row's own totalRecognizedRevenue/totalExpenses/netProfit/profitMargin
// using the same formula rollupOrders() itself uses server-side. Returns
// null if ratios aren't available (scenario inactive).
export function applyScenarioToRow(row, ratios) {
  if (!row || !ratios) return null;
  const recognizedCodRevenue = (row.codRevenue || 0) * (ratios.codRate / 100);
  const totalRecognizedRevenue = (row.prepaidRevenue || 0) + recognizedCodRevenue;
  const productCost = Math.max(0, (row.productCost || 0) * ratios.productCost);
  const packagingCost = Math.max(0, (row.packagingCost || 0) * ratios.packagingCost);
  const shippingCost = Math.max(0, (row.shippingCost || 0) * ratios.shippingCost);
  const otherCost = Math.max(0, (row.otherCost || 0) * ratios.otherCost);
  const totalProductExpense = productCost + packagingCost + shippingCost + otherCost;
  const advertisingExpense = Math.max(0, (row.spend || 0) * ratios.advertisingExpense);
  const operatingExpense = Math.max(0, (row.operatingExpense || 0) * ratios.operatingExpense);
  const totalExpenses = advertisingExpense + totalProductExpense + operatingExpense;
  const netProfit = totalRecognizedRevenue - totalExpenses;
  const profitMargin = totalRecognizedRevenue ? (netProfit / totalRecognizedRevenue) * 100 : 0;
  return {
    recognizedCodRevenue: round2(recognizedCodRevenue),
    totalRecognizedRevenue: round2(totalRecognizedRevenue),
    productCost: round2(productCost),
    packagingCost: round2(packagingCost),
    shippingCost: round2(shippingCost),
    otherCost: round2(otherCost),
    totalProductExpense: round2(totalProductExpense),
    advertisingExpense: round2(advertisingExpense),
    operatingExpense: round2(operatingExpense),
    totalExpenses: round2(totalExpenses),
    netProfit: round2(netProfit),
    profitMargin: round2(profitMargin),
  };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
