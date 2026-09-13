/** Undefined leaves transfer size unrestricted; Infinity explicitly overrides an inherited limit. */
export function resolveByteLimit(value: number | undefined): number {
    if (value === undefined || value === Infinity) {
        return Infinity;
    }

    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('maxBytes must be a non-negative safe integer or Infinity');
    }

    return value;
}
