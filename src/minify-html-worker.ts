import { isMainThread, parentPort } from "node:worker_threads";
import {
	type MinifierOptions as MinifyHTMLOptions,
	minify as minifyHTML,
} from "html-minifier-next";

if (isMainThread) {
	throw new Error("This file is meant to be run as a worker thread.");
}

// biome-ignore-start lint/style/noNonNullAssertion: I can assume `parentPort` is not null.
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
			parentPort!.postMessage({
				result: await minifyHTML(html, minifyHTMLOptions),
			});
		} catch (error) {
			parentPort!.postMessage({ error });
		}
	},
);
// biome-ignore-end lint/style/noNonNullAssertion: See start.
