export interface ImageSize {
	width: number;
	height: number;
}

/**
 * The displayed size of a PNG, JPEG, GIF, WebP or BMP image, read from its header. JPEGs
 * rotated by their EXIF orientation report their rotated size, as browsers show them.
 * Returns undefined for other formats and damaged files.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (offset: number, length: number) =>
		String.fromCharCode(...bytes.subarray(offset, offset + length));
	try {
		if (ascii(1, 3) === "PNG") return valid(view.getUint32(16), view.getUint32(20));
		if (ascii(0, 4) === "GIF8") return valid(view.getUint16(6, true), view.getUint16(8, true));
		if (ascii(0, 2) === "BM")
			return valid(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
		if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return webpSize(bytes, view, ascii);
		if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view, ascii);
	} catch {
		// A truncated header reads past the end of the file.
	}
	return undefined;
}

function webpSize(
	bytes: Uint8Array,
	view: DataView,
	ascii: (offset: number, length: number) => string,
): ImageSize | undefined {
	const chunk = ascii(12, 4);
	if (chunk === "VP8 ")
		return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
	if (chunk === "VP8L") {
		const [b0, b1, b2, b3] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!];
		return valid(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0xf) << 10) | (b2 << 2) | (b1 >> 6)));
	}
	if (chunk === "VP8X") {
		const uint24 = (offset: number) =>
			bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
		return valid(1 + uint24(24), 1 + uint24(27));
	}
	return undefined;
}

/** EXIF orientations 5 to 8 turn the image by 90 degrees. */
const ROTATED = new Set([5, 6, 7, 8]);

function jpegSize(
	bytes: Uint8Array,
	view: DataView,
	ascii: (offset: number, length: number) => string,
): ImageSize | undefined {
	let rotated = false;
	for (let offset = 2; offset + 9 < bytes.length;) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1]!;
		const length = view.getUint16(offset + 2);
		if (marker === 0xe1 && ascii(offset + 4, 6) === "Exif\0\0")
			rotated = ROTATED.has(exifOrientation(view, offset + 10) ?? 1);
		// Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			const height = view.getUint16(offset + 5);
			const width = view.getUint16(offset + 7);
			return rotated ? valid(height, width) : valid(width, height);
		}
		offset += 2 + length;
	}
	return undefined;
}

/** The orientation tag (0x0112) in the first image directory of a TIFF-format EXIF block. */
function exifOrientation(view: DataView, tiff: number): number | undefined {
	const little = view.getUint16(tiff) === 0x4949;
	const directory = tiff + view.getUint32(tiff + 4, little);
	const entries = view.getUint16(directory, little);
	for (let index = 0; index < entries; index++) {
		const entry = directory + 2 + index * 12;
		if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
	}
	return undefined;
}

function valid(width: number, height: number): ImageSize | undefined {
	return width > 0 && height > 0 ? { width, height } : undefined;
}
