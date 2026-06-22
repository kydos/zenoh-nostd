/**
 * z_bytes: Demonstrate the ZBytes payload conversions supported by zenoh-nostd.
 *
 * NOTE: the upstream @eclipse-zenoh/zenoh-ts z_bytes example also demonstrates
 * typed serialization (zserialize / ZBytesSerializer / NumberFormat / typed
 * arrays / Map / custom ZSerializeable). zenoh-nostd's ZBytes only supports raw
 * bytes, UTF-8 strings and JSON, so those typed demos are intentionally omitted.
 *
 * Usage: deno run z_bytes.ts
 */
import { ZBytes } from "@eclipse-zenoh/zenoh-ts";

// 1. String <-> ZBytes
{
    const input = "Hello from zenoh-nostd!";
    const zb = ZBytes.from(input);
    const output = zb.toString();
    console.log(`string : '${input}' -> ${zb.len()} bytes -> '${output}'`);
}

// 2. Uint8Array (raw bytes) <-> ZBytes
{
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const zb = ZBytes.from(input);
    const output = zb.toBytes();
    console.log(`bytes  : [${input}] -> ${zb.len()} bytes -> [${output}]`);
}

// 3. JSON object via serialize / deserialize
{
    const input = { name: "zenoh", version: 9, features: ["pub", "sub"] };
    const zb = ZBytes.serialize(input);
    const output = zb.deserialize<typeof input>();
    console.log(
        `json   : ${JSON.stringify(input)} -> ${zb.len()} bytes -> ${JSON.stringify(output)}`,
    );
}
