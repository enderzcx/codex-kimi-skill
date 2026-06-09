#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  console.error(`codex-kimi: ${error.message}`);
  process.exit(1);
});
