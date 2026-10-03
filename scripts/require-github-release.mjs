// Old Cloudflare build triggers still invoke this script during the cutover.
// They must never publish an unverified checkout or implicitly migrate production.
console.error("Website publishing moved to GitHub Actions: Deploy verified website. This legacy deployment command is disabled; no database or Worker changes were made.");
process.exitCode = 1;
