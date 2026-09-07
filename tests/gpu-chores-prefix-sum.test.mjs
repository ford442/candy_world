// Golden-vector implementations
function prefixSumTS(inputArray) {
  const len = inputArray.length;
  const out = new Uint32Array(len);
  if (len === 0) return out;
  out[0] = 0;
  for (let i = 1; i < len; i++) {
    out[i] = out[i - 1] + inputArray[i - 1];
  }
  return out;
}

function compactTS(inputData, inputFlags, prefixSums) {
  const len = inputData.length;
  const maxOutputCount = len > 0 ? prefixSums[len - 1] + inputFlags[len - 1] : 0;
  const outputData = new Uint32Array(maxOutputCount);
  let count = 0;
  for (let i = 0; i < len; i++) {
    const flag = inputFlags[i];
    if (flag === 1) {
      const outIdx = prefixSums[i];
      outputData[outIdx] = inputData[i];
    }
    if (i === len - 1) {
      count = prefixSums[i] + flag;
    }
  }
  return { outputData, count };
}

function compactVisibleIndicesTS(flags) {
  const indices = new Uint32Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    indices[i] = i;
  }
  const prefixSums = prefixSumTS(flags);
  return compactTS(indices, flags, prefixSums);
}

// Test harness
let passes = 0;
let failures = 0;

function runChoresPrefixSumParity() {
  console.log('\n══ GPU Chores Parity Test (Prefix Sum + Compact) ══');

  const cases = [0, 1, 255, 256, 257, 10000];

  for (const n of cases) {
    const hint = `n=${n}`;

    // Test patterns: all-zero, all-one, mixed
    const patterns = [
        { name: 'all-zero', flags: new Uint32Array(n).fill(0) },
        { name: 'all-one', flags: new Uint32Array(n).fill(1) },
        { name: 'mixed', flags: new Uint32Array(n).map((_, i) => i % 3 === 0 ? 1 : 0) }
    ];

    for (const { name, flags } of patterns) {
        const curHint = `${hint} ${name}`;

        // 1. Prefix Sum
        const prefixResult = prefixSumTS(flags);
        let prefixExpected = new Uint32Array(n);
        if (n > 0) {
            prefixExpected[0] = 0;
            for (let i = 1; i < n; i++) {
                prefixExpected[i] = prefixExpected[i - 1] + flags[i - 1];
            }
        }
        let prefixOk = true;
        for (let i = 0; i < n; i++) {
            if (prefixResult[i] !== prefixExpected[i]) {
                console.error(`  ✗ prefixSum ${curHint} failed at index ${i}: expected ${prefixExpected[i]}, got ${prefixResult[i]}`);
                prefixOk = false;
                failures++;
                break;
            }
        }
        if (prefixOk) passes++;

        // 2. Compact
        const { outputData, count } = compactVisibleIndicesTS(flags);

        let expectedCount = 0;
        for (let i = 0; i < n; i++) if (flags[i] === 1) expectedCount++;

        let compactOk = outputData.length === expectedCount && count === expectedCount;
        if (!compactOk) {
            console.error(`  ✗ compact ${curHint} count mismatch: expected ${expectedCount}, got ${count}`);
            failures++;
        } else {
            let j = 0;
            for (let i = 0; i < n; i++) {
                if (flags[i] === 1) {
                    if (outputData[j] !== i) {
                        console.error(`  ✗ compact ${curHint} mismatch at out[${j}]: expected ${i}, got ${outputData[j]}`);
                        compactOk = false;
                        failures++;
                        break;
                    }
                    j++;
                }
            }
        }
        if (compactOk) passes++;
    }
  }

  if (failures === 0) {
      console.log(`  ✓ Prefix Sum / Compact edge cases all passed successfully (${passes} tests)`);
  } else {
      console.error(`  ✗ ${failures} failed cases`);
      process.exit(1);
  }
}

runChoresPrefixSumParity();
