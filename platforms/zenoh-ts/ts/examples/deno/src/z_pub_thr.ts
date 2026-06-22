/**
 * z_pub_thr: Publish a fixed-size payload as fast as possible and print the
 * publish throughput (msg/s) once every measurement window.
 *
 * Mirrors the upstream @eclipse-zenoh/zenoh-ts z_pub_thr example: it publishes
 * on the hardcoded key 'test/thr' and runs forever. Pair it with z_sub_thr.
 *
 * Usage:
 *   deno run --allow-net z_pub_thr.ts [PAYLOAD_SIZE] [-e ws/127.0.0.1:7447] \
 *       [--express] [-p|--priority 5] [-n|--number 1000000]
 *
 * The thr-specific options are parsed inline rather than via the shared
 * parse_args.ts helper, which has no positional-arg / QoS-flag support.
 */
import { open, Config, Priority } from "@eclipse-zenoh/zenoh-ts";
import { parseArgs } from "./parse_args.ts";

const { locator } = parseArgs(Deno.args, {});

function flagValue(short: string, long: string): string | undefined {
    const argv = Deno.args;
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === `-${short}` || argv[i] === `--${long}`) return argv[i + 1];
    }
    return undefined;
}

const positional = Deno.args.find((a) => /^\d+$/.test(a));
const payloadSize = parseInt(positional ?? "8", 10);
const express = Deno.args.includes("--express");
const priority = parseInt(flagValue("p", "priority") ?? "5", 10) as Priority;
const window = parseInt(flagValue("n", "number") ?? "1000000", 10);

console.log(`Opening session on ${locator} ...`);
const session = await open(new Config(locator));

console.warn(`Will publish ${payloadSize} B payload on 'test/thr'.`);
const pub = await session.declarePublisher("test/thr", { express, priority });

const payload = new Uint8Array(payloadSize);
for (let i = 0; i < payloadSize; i++) payload[i] = i % 256;

let n = 0;
let start = performance.now();
while (true) {
    await pub.put(payload);
    n++;
    if (n % window === 0) {
        const end = performance.now();
        console.log(`${(window / (end - start)) * 1000} msg/s`);
        start = performance.now();
    }
}
