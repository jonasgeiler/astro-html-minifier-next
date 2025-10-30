import { readFile, writeFile } from "node:fs/promises";
import {
	type MinifierOptions as MinifyHTMLOptions,
	minify as minifyHTML,
} from "html-minifier-next";

export interface MinifyHTMLFileResult {
	savings: number;
	time: number;
}

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
	if (savings > 0) {
		// Only write the minified HTML to the file if it's smaller.
		await writeFile(htmlFile, minifiedHTML, {
			encoding: "utf8",
			signal,
		});
	}

	const timeEnd = performance.now(); // --- TIMED BLOCK END ---

	const time = timeEnd - timeStart;
	return { savings, time };
}
