/**
 * RFC 4180 CSV, written defensively for spreadsheet software.
 *
 * Two hazards this handles that a naive `values.join(',')` does not:
 *
 * 1. **Formula injection.** Excel and Google Sheets evaluate a cell beginning
 *    `=`, `+`, `-`, or `@` as a formula. Descriptions and member names are user
 *    input, so anyone who can name themselves `=HYPERLINK("http://evil","hi")`
 *    can get that executed in a teammate's spreadsheet. Risky cells are
 *    prefixed with an apostrophe, which Excel strips on display.
 *
 * 2. **Negative numbers.** They start with `-`, which means a careless
 *    injection guard turns `-440.79` into `'-440.79` and every balance in the
 *    file becomes text that won't sum. Numeric-looking cells are left alone.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function guardFormula(value: string): string {
  if (!RISKY_PREFIX.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value; // -440.79 must stay a number
  return `'${value}`;
}

function quote(value: string): string {
  // Quote when the value contains a delimiter, a quote, a newline, or has
  // padding that a parser would otherwise trim.
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  return quote(guardFormula(String(value)));
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/**
 * Excel needs a UTF-8 BOM to read names with accents or emoji correctly, and
 * CRLF line endings are what RFC 4180 specifies.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Minor units to a plain decimal a spreadsheet will treat as a number. */
export function csvAmount(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

/** Strips anything that would be awkward in a Content-Disposition filename. */
export function safeFilename(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'export'
  );
}
