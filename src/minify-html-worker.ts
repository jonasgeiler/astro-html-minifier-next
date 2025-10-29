import { isMainThread, parentPort } from "node:worker_threads";
import { minify as minifyHTML, type MinifierOptions as MinifyHTMLOptions } from "html-minifier-next";

if (isMainThread) {
	throw new Error("This file is meant to be run as a worker thread.");
}

parentPort!.on(
	"message",
	async ({
		html,
		minifyHTMLOptions,
	}: {
		html: string;
		minifyHTMLOptions: MinifyHTMLOptions;
	}) => {
		try {
			const result = await minifyHTML(html, minifyHTMLOptions);
			parentPort!.postMessage({ result });
		} catch (error) {
			parentPort!.postMessage({ error });
		}
	},
);
