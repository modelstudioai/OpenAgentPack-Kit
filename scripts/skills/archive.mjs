import { gzipSync } from "node:zlib";

function timestampField(mtimeMs, path) {
	const seconds = Math.floor(mtimeMs / 1000);
	if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 0o77777777777)
		throw new Error(`Invalid archive modification time: ${path}`);
	return `${seconds.toString(8).padStart(11, "0")}\0`;
}

/** USTAR output preserves source modification times, without host paths or owners. */
export function createArchive(files) {
	const blocks = [];
	for (const { path, content, mtimeMs } of [...files].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
		if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`Unsafe archive path: ${path}`);
		const header = Buffer.alloc(512);
		const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
		const slash = path.lastIndexOf("/");
		const name = Buffer.byteLength(path) > 100 ? path.slice(slash + 1) : path;
		const prefix = Buffer.byteLength(path) > 100 ? path.slice(0, slash) : "";
		if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155)
			throw new Error(`Archive path too long: ${path}`);
		header.write(name, 0, 100);
		header.write("0000644\0", 100, 8);
		header.write("0000000\0", 108, 8);
		header.write("0000000\0", 116, 8);
		header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12);
		header.write(timestampField(mtimeMs, path), 136, 12);
		header.fill(32, 148, 156);
		header.write("0", 156);
		header.write("ustar\0", 257, 6);
		header.write("00", 263, 2);
		header.write(prefix, 345, 155);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
		blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks), { level: 9 });
}
