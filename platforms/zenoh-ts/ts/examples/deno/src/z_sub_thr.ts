/**
 * z_sub_thr: Subscribe to 'test/thr' and measure receive throughput (msg/s).
 *
 * Mirrors the upstream @eclipse-zenoh/zenoh-ts z_sub_thr example. It counts
 * received samples into rounds of `--number` messages, prints the throughput
 * for each round, and self-terminates after `--samples` rounds (there is no
 * external "finished" signal from the publisher). Pair it with z_pub_thr.
 *
 * Usage:
 *   deno run --allow-net z_sub_thr.ts [-e ws/127.0.0.1:7447] \
 *       [-n|--number 100000] [-s|--samples 10]
 */
import { open, Config, type Sample } from "@eclipse-zenoh/zenoh-ts";
import { parseArgs } from "./parse_args.ts";

const { locator } = parseArgs(Deno.args, {});

function flagValue(short: string, long: string): string | undefined {
    const argv = Deno.args;
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === `-${short}` || argv[i] === `--${long}`) return argv[i + 1];
    }
    return undefined;
}

const roundSize = parseInt(flagValue("n", "number") ?? "100000", 10);
const samples = parseInt(flagValue("s", "samples") ?? "10", 10);

class Stats {
    private roundCount = 0;
    finishedRounds = 0;
    private roundStart = performance.now();

    constructor(private readonly roundSize: number) {}

    increment(): void {
        if (this.roundCount === 0) {
            this.roundStart = performance.now();
            this.roundCount = 1;
        } else if (this.roundCount < this.roundSize) {
            this.roundCount += 1;
        } else {
            this.printRound();
            this.finishedRounds += 1;
            this.roundCount = 0;
        }
    }

    private printRound(): void {
        const elapsedMs = performance.now() - this.roundStart;
        console.warn(`${this.roundSize / (elapsedMs / 1000)} msg/s`);
    }
}

console.log(`Opening session on ${locator} ...`);
const session = await open(new Config(locator));

const stats = new Stats(roundSize);
console.warn("Subscribing on 'test/thr' ...");
await session.declareSubscriber("test/thr", { handler: (_s: Sample) => stats.increment() });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
while (stats.finishedRounds < samples) {
    await sleep(500);
}

await session.close();
