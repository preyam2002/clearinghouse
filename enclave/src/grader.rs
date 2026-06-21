//! The in-enclave predicate executor + quality scorer.
//!
//! Mirrors `packages/agents/src/runner.ts`: the delivered code and tests are
//! written to a throwaway dir and run under `node --test` (TAP reporter,
//! timeout-guarded). Quality is the fraction of delivered tests that pass,
//! scaled to 0–100 — a real measurement the enclave attests to.

use std::fs;
use std::process::{Command, Stdio};
use std::time::Duration;
use tempfile::tempdir;
use wait_timeout::ChildExt;

#[derive(Debug, Clone)]
pub struct GradeResult {
    pub quality_score: u64,
    pub passed: bool,
    pub transcript: String,
}

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

pub fn grade(code: &str, tests: &str) -> std::io::Result<GradeResult> {
    grade_with_timeout(code, tests, DEFAULT_TIMEOUT)
}

pub fn grade_with_timeout(code: &str, tests: &str, timeout: Duration) -> std::io::Result<GradeResult> {
    let dir = tempdir()?;
    fs::write(dir.path().join("solution.mjs"), code)?;
    fs::write(dir.path().join("solution.test.mjs"), tests)?;
    let log_path = dir.path().join("out.log");
    let log = fs::File::create(&log_path)?;
    let log_err = log.try_clone()?;

    let mut child = Command::new("node")
        .args(["--test", "--test-reporter=tap", "solution.test.mjs"])
        .current_dir(dir.path())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()?;

    let status = match child.wait_timeout(timeout)? {
        Some(status) => Some(status),
        None => {
            child.kill()?;
            child.wait()?;
            None
        }
    };

    let mut transcript = fs::read_to_string(&log_path).unwrap_or_default();
    let timed_out = status.is_none();
    if timed_out {
        transcript.push_str(&format!("\n[killed after {}ms]", timeout.as_millis()));
    }
    let exit_ok = status.map(|s| s.success()).unwrap_or(false);

    let (pass, fail) = parse_tap_counts(&transcript);
    let total = pass + fail;
    let quality_score = if total > 0 {
        (pass * 100) / total
    } else if exit_ok && !timed_out {
        100
    } else {
        0
    };

    Ok(GradeResult { quality_score, passed: quality_score == 100 && exit_ok, transcript })
}

/// Pull `# pass N` / `# fail N` out of the TAP summary.
fn parse_tap_counts(transcript: &str) -> (u64, u64) {
    let mut pass = 0u64;
    let mut fail = 0u64;
    for line in transcript.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("# pass ") {
            pass = rest.trim().parse().unwrap_or(pass);
        } else if let Some(rest) = line.strip_prefix("# fail ") {
            fail = rest.trim().parse().unwrap_or(fail);
        }
    }
    (pass, fail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tap_summary() {
        let tap = "TAP version 13\nok 1 - adds\n# tests 1\n# pass 1\n# fail 0\n";
        assert_eq!(parse_tap_counts(tap), (1, 0));
        let mixed = "# pass 3\n# fail 1\n";
        assert_eq!(parse_tap_counts(mixed), (3, 1));
    }

    // Exercises the real `node --test` path. Requires node on PATH, so it is
    // opt-in: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn good_code_scores_100_broken_scores_0() {
        let tests = "import { add } from \"./solution.mjs\";\nimport test from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"adds\", () => { assert.equal(add(2, 3), 5); });\n";
        let good = grade("export function add(a, b) { return a + b; }\n", tests).unwrap();
        assert_eq!(good.quality_score, 100);
        let broken = grade("export function add(a, b) { return a - b; }\n", tests).unwrap();
        assert_eq!(broken.quality_score, 0);
    }
}
