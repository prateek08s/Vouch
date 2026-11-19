// Prints the months a scheduled Hacker News refresh should process, comma-separated:
// finished months since 2025-01 that have no committed verdicts, plus last month and this month.
//
//   npx tsx scripts/hn/pending-months.mts [--data-dir data/hn]
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pendingMonths } from "@/lib/hn/months";

const { values: args } = parseArgs({ options: { "data-dir": { type: "string", default: path.join("data", "hn") } } });
const dir = path.join(args["data-dir"]!, "verdicts");
const have = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 7)) : [];
console.log(pendingMonths(have, new Date()).join(","));
