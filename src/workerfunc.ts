import {
	type MinifierOptions as MinifyHtmlOptions,
	minify as minifyHtml,
} from "html-minifier-next";
import { readFile, writeFile } from "node:fs/promises";

export default async function minifyHtmlFile(htmlFile: string, minifyHtmlOptions: MinifyHtmlOptions) {
	const html = await readFile(htmlFile, {
		encoding: "utf8",
		// TODO: Use signal?
	});
	const minifiedHtml = await minifyHtml(html, minifyHtmlOptions);

	const htmlSize = Buffer.byteLength(html);
	const minifiedHtmlSize = Buffer.byteLength(minifiedHtml);
	if (minifiedHtmlSize >= htmlSize) {
		// No actual file size savings, so we skip writing the file or logging anything.
		return;
	}

	await writeFile(htmlFile, minifiedHtml, {
		encoding: "utf8",
		// TODO: Use signal?
	});
}
