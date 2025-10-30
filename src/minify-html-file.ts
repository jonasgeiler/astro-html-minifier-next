import { readFile, writeFile } from "node:fs/promises";
import {
	type MinifierOptions as MinifyHTMLOptions,
	minify as minifyHTML,
} from "html-minifier-next";

export type MinifyHTMLFileResult =
	| {
			savings: number;
			time: number;
	  }
	| false;

export async function minifyHTMLFile(
	htmlFile: string,
	minifyHTMLOptions: MinifyHTMLOptions,
	signal?: AbortSignal,
): Promise<MinifyHTMLFileResult> {
	const timeStart = performance.now(); // --- TIMED BLOCK START ---

	const html = await readFile(htmlFile, {
		encoding: "utf8",
		signal,
	});
	const minifiedHTML = await minifyHTML(html, minifyHTMLOptions);

	const savings = Buffer.byteLength(html) - Buffer.byteLength(minifiedHTML);
	if (savings <= 0) {
		// No actual file size savings, so we skip writing the file or logging anything.
		return false;
	}

	await writeFile(htmlFile, minifiedHTML, {
		encoding: "utf8",
		signal,
	});

	const timeEnd = performance.now(); // --- TIMED BLOCK END ---

	const time = timeEnd - timeStart;
	return { savings, time };
}
