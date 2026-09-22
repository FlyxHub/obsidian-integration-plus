import { expect, test } from "@effect/vitest";
import { imageSize } from "./imageSize";

/** Bytes from numbers and ASCII strings, for building image headers. */
function bytes(...parts: (number | string | number[])[]): Uint8Array {
	const out: number[] = [];
	for (const part of parts) {
		if (typeof part === "string") out.push(...[...part].map((char) => char.charCodeAt(0)));
		else if (Array.isArray(part)) out.push(...part);
		else out.push(part);
	}
	return Uint8Array.from(out);
}

const u16be = (value: number) => [value >> 8, value & 0xff];
const u16le = (value: number) => [value & 0xff, value >> 8];
const u32be = (value: number) => [...u16be(value >>> 16), ...u16be(value & 0xffff)];
const u32le = (value: number) => [...u16le(value & 0xffff), ...u16le(value >>> 16)];

test("reads PNG, GIF and BMP sizes", () => {
	const png = bytes(0x89, "PNG", [13, 10, 26, 10], u32be(13), "IHDR", u32be(2400), u32be(1200));
	expect(imageSize(png)).toEqual({ width: 2400, height: 1200 });
	expect(imageSize(bytes("GIF89a", u16le(64), u16le(32)))).toEqual({ width: 64, height: 32 });
	const bmp = bytes("BM", new Array<number>(16).fill(0), u32le(300), u32le(-200 >>> 0));
	expect(imageSize(bmp)).toEqual({ width: 300, height: 200 });
});

test("reads JPEG sizes, swapping them when EXIF rotates the image", () => {
	const frame = [0xff, 0xc0, ...u16be(17), 8, ...u16be(600), ...u16be(800), 3];
	expect(imageSize(bytes(0xff, 0xd8, frame))).toEqual({ width: 800, height: 600 });

	// An EXIF block with one directory entry: orientation 6 (rotated 90 degrees).
	const tiff = [..."MM".split("").map((c) => c.charCodeAt(0)), 0, 42, ...u32be(8)];
	const directory = [...u16be(1), ...u16be(0x0112), ...u16be(3), ...u32be(1), ...u16be(6), 0, 0];
	const exif = [...bytes("Exif", 0, 0), ...tiff, ...directory];
	const app1 = [0xff, 0xe1, ...u16be(exif.length + 2), ...exif];
	expect(imageSize(bytes(0xff, 0xd8, app1, frame))).toEqual({ width: 600, height: 800 });
});

test("reads WebP sizes", () => {
	const header = (chunk: string, body: number[]) =>
		bytes("RIFF", u32le(0), "WEBP", chunk, u32le(0), body);
	const vp8x = header("VP8X", [0, 0, 0, 0, 1279 & 0xff, 1279 >> 8, 0, 719 & 0xff, 719 >> 8, 0]);
	expect(imageSize(vp8x)).toEqual({ width: 1280, height: 720 });
	const lossless = header("VP8L", [0x2f, 99, 0x40, 0x06, 0x00]);
	expect(imageSize(lossless)).toEqual({ width: 100, height: 26 });
});

test("returns undefined for other formats and truncated files", () => {
	expect(imageSize(bytes("<svg"))).toBeUndefined();
	expect(imageSize(bytes(0x89, "PNG"))).toBeUndefined();
	expect(imageSize(new Uint8Array())).toBeUndefined();
});
