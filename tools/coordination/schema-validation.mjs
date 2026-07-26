import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const taskSchema = readSchema('schemas/agent-task.schema.json');
const boardSchema = readSchema('schemas/agent-board.schema.json');
const handoffSchema = readSchema('schemas/agent-handoff.schema.json');
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/u;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: isStrictRfc3339,
});
ajv.addSchema(taskSchema);
const boardValidator = ajv.compile(boardSchema);
const handoffValidator = ajv.compile(handoffSchema);

export function validateBoardShape(value) {
  return validateWith(boardValidator, value, 'BOARD_SCHEMA_INVALID');
}

export function validateHandoffShape(value) {
  return validateWith(handoffValidator, value, 'HANDOFF_SCHEMA_INVALID');
}

export function isStrictRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offset,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59) {
    return false;
  }
  if (offset !== 'Z'
    && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validateWith(validator, value, code) {
  if (validator(value)) return [];
  return (validator.errors ?? []).map((error) => ({
    code,
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message,
  }));
}

function readSchema(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function daysInMonth(year, month) {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
