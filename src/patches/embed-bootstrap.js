import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv[2]) {
  throw new Error("usage: embed-bootstrap.js /path/to/Dia Custom.app [bootstrap.dylib]");
}
const app = resolve(process.argv[2]);
if (basename(dirname(app)) !== "work" || !basename(app).startsWith("Dia Custom")) {
  throw new Error(`refusing to modify a non-clone app: ${app}`);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDylib = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(scriptDir, "../../.build/bootstrap/offline-bootstrap.dylib");
const embeddedDylib = resolve(app, "Contents/Frameworks/DiaCustomBootstrap.dylib");
const executable = resolve(app, "Contents/MacOS/Dia");
const loadPath = "@executable_path/../Frameworks/DiaCustomBootstrap.dylib";

await copyFile(sourceDylib, embeddedDylib);
await chmod(embeddedDylib, 0o755);

const data = await readFile(executable);
if (data.readUInt32LE(0) !== 0xfeedfacf || data.readUInt32LE(12) !== 2) {
  throw new Error("expected a little-endian 64-bit Mach-O executable");
}

if (data.includes(Buffer.from(`${loadPath}\0`))) {
  process.stdout.write(`Updated embedded bootstrap in ${app}\n`);
  process.exit(0);
}

const commandCount = data.readUInt32LE(16);
const commandBytes = data.readUInt32LE(20);
const commandStart = 32;
const commandEnd = commandStart + commandBytes;
const pathBytes = Buffer.from(`${loadPath}\0`);
const commandSize = Math.ceil((24 + pathBytes.length) / 8) * 8;

let cursor = commandStart;
let firstSectionOffset = data.length;
for (let index = 0; index < commandCount; index += 1) {
  const command = data.readUInt32LE(cursor);
  const size = data.readUInt32LE(cursor + 4);
  if (size < 8 || cursor + size > commandEnd) {
    throw new Error(`invalid Mach-O load command ${index}`);
  }
  if (command === 0x19) {
    const sectionCount = data.readUInt32LE(cursor + 64);
    let sectionCursor = cursor + 72;
    for (let section = 0; section < sectionCount; section += 1) {
      const sectionOffset = data.readUInt32LE(sectionCursor + 48);
      if (sectionOffset > 0) firstSectionOffset = Math.min(firstSectionOffset, sectionOffset);
      sectionCursor += 80;
    }
  }
  cursor += size;
}

if (cursor !== commandEnd || commandEnd + commandSize > firstSectionOffset) {
  throw new Error("not enough Mach-O header padding for the embedded bootstrap");
}
for (const byte of data.subarray(commandEnd, commandEnd + commandSize)) {
  if (byte !== 0) throw new Error("Mach-O header padding is not empty");
}

const command = Buffer.alloc(commandSize);
command.writeUInt32LE(0x0c, 0); // LC_LOAD_DYLIB
command.writeUInt32LE(commandSize, 4);
command.writeUInt32LE(24, 8); // dylib.name offset
command.writeUInt32LE(0, 12); // timestamp
command.writeUInt32LE(0, 16); // current version
command.writeUInt32LE(0, 20); // compatibility version
pathBytes.copy(command, 24);
command.copy(data, commandEnd);
data.writeUInt32LE(commandCount + 1, 16);
data.writeUInt32LE(commandBytes + commandSize, 20);
await writeFile(executable, data);
process.stdout.write(`Embedded Dia Custom bootstrap in ${app}\n`);
