import { deps } from "../scripts/ds_search.mjs";

/** Temporarily replace side-effecting dependencies used inside the CLI module. */
export async function withDeps(overrides, fn) {
  const saved = { ...deps };
  Object.assign(deps, overrides);
  try {
    return await fn();
  } finally {
    Object.assign(deps, saved);
  }
}

/** Recording async stub; `impl` may be a value, a function, or a list consumed per call (Errors are thrown). */
export function stub(impl) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    let value = Array.isArray(impl) ? impl[calls.length - 1] : typeof impl === "function" ? impl(...args) : impl;
    if (value instanceof Error) throw value;
    return value;
  };
  fn.calls = calls;
  return fn;
}

export function syncStub(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    const value = typeof impl === "function" ? impl(...args) : impl;
    if (value instanceof Error) throw value;
    return value;
  };
  fn.calls = calls;
  return fn;
}

/** Capture stdout/stderr written while `fn` runs. */
export async function capture(fn) {
  const out = [], err = [];
  const [stdout, stderr] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (chunk) => (out.push(String(chunk)), true);
  process.stderr.write = (chunk) => (err.push(String(chunk)), true);
  try {
    const result = await fn();
    return { result, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}
