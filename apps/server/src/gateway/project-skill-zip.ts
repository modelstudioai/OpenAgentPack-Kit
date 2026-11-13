import { KitError } from "@openagentpack/kit-sdk/protocol";

const malformed = () => new KitError("invalid_request", "ZIP 目录无效或格式不受支持");

/** 在解包库覆盖同名项之前检查原始中央目录；不实现压缩算法，也不读取库的私有字段。 */
export function inspectSkillZipDirectory(bytes: Uint8Array): Set<string> {
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = findDirectoryEnd(buffer);
	const count = buffer.readUInt16LE(end + 10);
	const offset = buffer.readUInt32LE(end + 16);
	const length = buffer.readUInt32LE(end + 12);
	if (
		buffer.readUInt16LE(end + 4) !== 0 ||
		buffer.readUInt16LE(end + 6) !== 0 ||
		buffer.readUInt16LE(end + 8) !== count ||
		!count ||
		count > 1000 ||
		offset + length !== end
	)
		throw malformed();
	const names = new Set<string>();
	const folded = new Set<string>();
	let cursor = offset;
	for (let index = 0; index < count; index++) {
		const entry = readDirectoryEntry(buffer, cursor, end);
		const key = entry.name.normalize("NFC").toLowerCase();
		if (folded.has(key)) throw new KitError("invalid_request", "ZIP 含重复文件路径");
		folded.add(key);
		names.add(entry.name);
		cursor = entry.next;
	}
	if (cursor !== end) throw malformed();
	return names;
}

function findDirectoryEnd(buffer: Buffer): number {
	for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
		if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length)
			return offset;
	}
	throw malformed();
}

function readDirectoryEntry(buffer: Buffer, offset: number, end: number) {
	if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw malformed();
	const nameLength = buffer.readUInt16LE(offset + 28);
	const extraLength = buffer.readUInt16LE(offset + 30);
	const commentLength = buffer.readUInt16LE(offset + 32);
	const next = offset + 46 + nameLength + extraLength + commentLength;
	if (!nameLength || next > end || buffer.readUInt16LE(offset + 34) !== 0) throw malformed();
	const uncompressed = buffer.readUInt32LE(offset + 24);
	if (uncompressed > 8 * 1024 * 1024) throw new KitError("invalid_request", "Skill 解压后单文件不能超过 8 MiB");
	let name: string;
	try {
		name = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
	} catch {
		throw new KitError("invalid_request", "ZIP 文件名必须使用 UTF-8 编码");
	}
	return { name, next };
}
