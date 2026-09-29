// Rough token prices (USD per million tokens) for the ~$ readout under the composer.
// These are estimates that give a sense of scale, not billing figures. Anyone can override an
// entry from the console:  localStorage["openghost.prices"] = { "deepseek-flash": { "in": 0.27,
// "cached": 0.07, "out": 1.1 } }  — models without a price simply show no readout.
(() => {
'use strict';

const TABLE = {
 'deepseek-flash': { in: 0.27, cached: 0.07, out: 1.1 },
 'deepseek-v4-pro': { in: 0.55, cached: 0.14, out: 2.19 },
};

const read = () => {
 try {
  return { ...TABLE, ...(JSON.parse(localStorage.getItem('openghost.prices')) || {}) };
 } catch {
  return TABLE;
 }
};

window.Prices = {
 of(id) {
  const entry = read()[id];
  return entry && Number.isFinite(entry.in) && Number.isFinite(entry.out) ? entry : null;
 },
 // What a chat's collected usage costs at those rates, or null when the model has no prices.
 cost(model, spend) {
  const price = window.Prices.of(model);
  if (!price || !spend) return null;
  const cached = Math.max(0, Math.min(Number(spend.cached) || 0, Number(spend.input) || 0));
  const fresh = Math.max(0, (Number(spend.input) || 0) - cached);
  return fresh / 1e6 * price.in + cached / 1e6 * (price.cached ?? price.in) + (Number(spend.output) || 0) / 1e6 * price.out;
 },
 // Small amounts need more decimals than large ones.
 format(value) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
 },
};
})();
