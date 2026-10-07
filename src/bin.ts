#!/usr/bin/env node
import { text } from "node:stream/consumers";
import { run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  readStdin: async () => (process.stdin.isTTY ? null : text(process.stdin)),
});
