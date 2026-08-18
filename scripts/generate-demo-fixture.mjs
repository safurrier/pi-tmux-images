import { fileURLToPath } from "node:url";
import sharp from "sharp";

const output = new URL("../assets/demo-fixture.png", import.meta.url);
const glyphs = {
	A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
	E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
	G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
	I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
	M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
	N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
	O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
	P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
	R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
	U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
	V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
	Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

function pixelText(text, x, y, scale, fill) {
	const cells = [];
	for (const [letterIndex, letter] of [...text].entries()) {
		const rows = glyphs[letter];
		if (!rows) continue;
		for (const [row, bits] of rows.entries())
			for (const [column, bit] of [...bits].entries())
				if (bit === "1")
					cells.push(
						`<rect x="${x + letterIndex * scale * 6 + column * scale}" y="${y + row * scale}" width="${scale}" height="${scale}"/>`,
					);
	}
	return `<g fill="${fill}">${cells.join("")}</g>`;
}

const artwork = `<svg width="640" height="360" viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">
  <title>Never gonna give your image up</title>
  <rect width="640" height="360" fill="#16202a"/>
  <rect x="40" y="40" width="560" height="280" rx="16" fill="#203040" stroke="#6fa8dc" stroke-width="2"/>
  <path d="M92 92h118v76H92z" fill="#f2c14e"/>
  <path d="M112 112h78v36h-78z" fill="#16202a"/>
  <path d="M132 174h38v56a28 28 0 0 1-56 0v-56z" fill="#7dd3a7"/>
  <path d="M104 230a47 47 0 0 0 94 0M151 277v24M122 301h58" fill="none" stroke="#e8f1f8" stroke-width="9" stroke-linecap="round"/>
  <rect x="250" y="80" width="310" height="210" rx="8" fill="#16202a" stroke="#6fa8dc" stroke-width="8"/>
  ${pixelText("NEVER GONNA", 274, 112, 4, "#f2c14e")}
  ${pixelText("GIVE YOUR", 298, 164, 4, "#7dd3a7")}
  ${pixelText("IMAGE UP", 310, 216, 4, "#e8f1f8")}
</svg>`;

await sharp(Buffer.from(artwork)).png().toFile(fileURLToPath(output));
