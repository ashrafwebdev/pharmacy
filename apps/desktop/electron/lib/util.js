'use strict';

const { randomUUID } = require('node:crypto');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const newId = () => randomUUID();
const nowIso = () => new Date().toISOString();

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Local calendar date as YYYY-MM-DD. */
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDate(parsed) === value;
}

/** ISO bounds [start, end) covering the local calendar days from..to inclusive. */
function dayBounds(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function isInt(value) {
  return Number.isInteger(value);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  newId,
  nowIso,
  localDate,
  isDate,
  dayBounds,
  isInt,
  cleanText,
};
