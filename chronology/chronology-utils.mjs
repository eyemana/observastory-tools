const UNIT_MS = {
  ms: 1n,
  millisecond: 1n,
  milliseconds: 1n,
  s: 1000n,
  second: 1000n,
  seconds: 1000n,
  minute: 60_000n,
  minutes: 60_000n,
  hour: 3_600_000n,
  hours: 3_600_000n,
  day: 86_400_000n,
  days: 86_400_000n,
  week: 604_800_000n,
  weeks: 604_800_000n,
  month: 2_629_746_000n,
  months: 2_629_746_000n,
  year: 31_556_952_000n,
  years: 31_556_952_000n
};

const SCALE_WORDS = {
  thousand: 1_000n,
  million: 1_000_000n,
  billion: 1_000_000_000n,
  trillion: 1_000_000_000_000n
};

function normalize(value) {
  return String(value ?? "").trim();
}

function decimalToBigInt(value, multiplier) {
  const raw = normalize(value);
  const match = raw.match(/^([+-])?(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const fractionScale = 10n ** BigInt(fraction.length);
  const fractionValue = fraction
    ? (BigInt(fraction) * multiplier) / fractionScale
    : 0n;

  return sign * ((whole * multiplier) + fractionValue);
}

function parseRelativeChronology(value) {
  const text = normalize(value).toLowerCase();
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)?\s*([a-z]+)(?:\b|$)(.*)$/);

  if (!match) {
    return null;
  }

  const [, amount, scaleWord, unit, rest] = match;
  const unitMs = UNIT_MS[unit];

  if (!unitMs) {
    return null;
  }

  const scale = scaleWord ? SCALE_WORDS[scaleWord] : 1n;
  const magnitude = decimalToBigInt(amount, unitMs * scale);

  if (magnitude === null) {
    return null;
  }

  const relativeText = rest.trim();
  const shouldInvert = /\b(before|prior to|ago)\b/.test(relativeText) && magnitude > 0n;
  const sort = shouldInvert ? -magnitude : magnitude;

  return {
    sort: sort.toString(),
    sortUnit: "ms",
    precision: unit.startsWith("ms") || unit.startsWith("millisecond")
      ? "millisecond"
      : unit.replace(/s$/, ""),
    parser: "relative-duration"
  };
}

function parseIsoChronology(value) {
  const text = normalize(value);

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    sort: BigInt(timestamp).toString(),
    sortUnit: "ms",
    precision: /\.\d{1,3}/.test(text) ? "millisecond" : "second",
    parser: "iso-date"
  };
}

export function parseChronologyValue(value) {
  const text = normalize(value);

  if (!text) {
    return {
      ok: false,
      status: "missing",
      error: "chronology_value is empty."
    };
  }

  const parsed = parseIsoChronology(text) ?? parseRelativeChronology(text);

  if (!parsed) {
    return {
      ok: false,
      status: "invalid",
      error: `Could not parse chronology_value: ${text}`
    };
  }

  return {
    ok: true,
    status: "ok",
    value: text,
    ...parsed
  };
}

export function compareChronologySort(a, b) {
  const left = normalize(a);
  const right = normalize(b);

  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  if (!/^-?\d+$/.test(left) || !/^-?\d+$/.test(right)) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return left.localeCompare(right);
  }

  const leftNegative = left.startsWith("-");
  const rightNegative = right.startsWith("-");

  if (leftNegative !== rightNegative) {
    return leftNegative ? -1 : 1;
  }

  const leftDigits = left.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  const rightDigits = right.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  let result = leftDigits.length - rightDigits.length ||
    leftDigits.localeCompare(rightDigits);

  if (leftNegative && rightNegative) {
    result *= -1;
  }

  return result;
}
